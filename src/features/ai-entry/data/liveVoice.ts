import {NativeEventEmitter, NativeModules} from 'react-native';
import {API_ROOT} from '@config/env';
import {ApiError} from '@api/client';
import {useAuthStore} from '@store/auth.store';

export type LiveVoiceState = 'idle' | 'connecting' | 'recording' | 'finishing';
export const isLiveVoiceAvailable = () => !!NativeModules.VoicePcm;

interface Callbacks {
  language: string | null;
  onState: (state: LiveVoiceState) => void;
  onText: (text: string) => void;
  onComplete: (text: string) => void;
  onError: (error: Error) => void;
}

/** PCM travels only after both backend authorization and Muse's acknowledgement. */
export function createLiveVoice(callbacks: Callbacks) {
  const native = NativeModules.VoicePcm;
  const emitter = new NativeEventEmitter(native);
  const socket = new WebSocket(`${API_ROOT.replace(/^http/, 'ws')}/voice/live`);
  let settled = false;
  let ending = false;
  let ready = false;
  let sentBytes = 0;
  let acceptedBytes = 0;
  let finalText: string | undefined;
  let dataListener: {remove(): void} | undefined;
  let errorListener: {remove(): void} | undefined;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout>;

  const finish = async (error?: Error, cancelled = false) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(watchdog);
    clearTimeout(limitTimer);
    socket.close();
    try {
      await native.stop();
    } catch {
      /* Already interrupted/stopped. */
    }
    dataListener?.remove();
    errorListener?.remove();
    callbacks.onState('idle');
    if (cancelled) {
      return;
    }
    if (error) {
      callbacks.onError(error);
    } else if (!finalText?.trim()) {
      callbacks.onError(new ApiError(422, 'No speech detected.'));
    } else {
      callbacks.onComplete(finalText.trim());
    }
  };
  const armTimeout = (ms: number) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      finish(new Error('Live transcription timed out. Please try again.'));
    }, ms);
  };
  const stop = async () => {
    if (settled || ending || !ready) {
      return;
    }
    ending = true;
    callbacks.onState('finishing');
    clearTimeout(limitTimer);
    armTimeout(30_000);
    try {
      // Native stop resolves after capture stops; already emitted frames arrive
      // before this result, so they are sent before endStream on the same socket.
      await native.stop();
      dataListener?.remove();
      if (!settled && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({type: 'endStream'}));
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  };

  callbacks.onState('connecting');
  armTimeout(30_000);
  socket.onopen = () => {
    if (settled) {
      return;
    }
    socket.send(
      JSON.stringify({
        token: useAuthStore.getState().token,
        language: callbacks.language,
      }),
    );
  };
  socket.onmessage = async event => {
    if (settled) {
      return;
    }
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'error') {
        finish(new ApiError(message.status ?? 502, message.message));
      } else if (message.type === 'ready' && !ready) {
        ready = true;
        dataListener = emitter.addListener('voicePcmData', (audio: string) => {
          if (settled || socket.readyState !== WebSocket.OPEN) {
            return;
          }
          // RN doesn't implement bufferedAmount. Bound unacknowledged PCM to
          // five seconds so a stalled network cannot accumulate a long upload.
          sentBytes +=
            (audio.length * 3) / 4 -
            (audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0);
          if (sentBytes - acceptedBytes > 240_000) {
            finish(new Error('Connection is too slow for live audio.'));
            return;
          }
          try {
            socket.send(JSON.stringify({type: 'audio', audio}));
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          if (!ending) {
            armTimeout(10_000);
          }
        });
        errorListener = emitter.addListener(
          'voicePcmError',
          (messageText: string) => {
            finish(new Error(messageText));
          },
        );
        await native.start();
        if (settled) {
          return;
        }
        callbacks.onState('recording');
        armTimeout(10_000);
        limitTimer = setTimeout(() => {
          stop();
        }, 115_000);
      } else if (
        message.type === 'audioAccepted' &&
        typeof message.bytes === 'number'
      ) {
        acceptedBytes = message.bytes;
      } else if (
        message.type === 'transcript' &&
        typeof message.transcript === 'string'
      ) {
        // Muse's CUMULATIVE partials replace the previous hypothesis.
        callbacks.onText(message.transcript);
        if (message.final === true) {
          finalText = message.transcript;
        }
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  };
  socket.onerror = () => {
    finish(new Error('Could not connect to live transcription.'));
  };
  socket.onclose = event => {
    finish(
      event.code === 1000 && finalText !== undefined
        ? undefined
        : new Error('Live transcription disconnected before completion.'),
    );
  };
  return {stop, cancel: () => finish(undefined, true)};
}
