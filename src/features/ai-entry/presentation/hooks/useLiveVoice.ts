import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {createLiveVoice, type LiveVoiceState} from '../../data/liveVoice';
import {ensureMicPermission} from '../../data/voiceRecorder';

export function useLiveVoice(callbacks: {
  language: string | null;
  onText: (text: string) => void;
  onComplete: (text: string) => void;
  onError: (error: Error) => void;
}) {
  const [state, setState] = useState<LiveVoiceState>('idle');
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const session = useRef<ReturnType<typeof createLiveVoice> | null>(null);
  const starting = useRef(false);
  const generation = useRef(0);

  const cancel = useCallback(() => {
    generation.current++;
    starting.current = false;
    const active = session.current;
    session.current = null;
    active?.cancel();
    setState('idle');
  }, []);
  useFocusEffect(useCallback(() => cancel, [cancel]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next === 'background') {
        cancel();
      }
    });
    return () => listener.remove();
  }, [cancel]);

  const start = async () => {
    if (session.current || starting.current) {
      return;
    }
    starting.current = true;
    const current = ++generation.current;
    setState('connecting');
    try {
      const allowed = await ensureMicPermission();
      if (current !== generation.current) {
        return;
      }
      if (!allowed) {
        throw new Error('Microphone permission is required.');
      }
      session.current = createLiveVoice({
        language: latest.current.language,
        onState: next => {
          if (current !== generation.current) {
            return;
          }
          setState(next);
          if (next === 'idle') {
            session.current = null;
          }
        },
        onText: text => {
          if (current === generation.current) {
            latest.current.onText(text);
          }
        },
        onComplete: text => {
          if (current === generation.current) {
            latest.current.onComplete(text);
          }
        },
        onError: error => {
          if (current === generation.current) {
            latest.current.onError(error);
          }
        },
      });
    } catch (error) {
      if (current !== generation.current) {
        return;
      }
      setState('idle');
      latest.current.onError(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      if (current === generation.current) {
        starting.current = false;
      }
    }
  };
  return {state, start, stop: () => session.current?.stop()};
}
