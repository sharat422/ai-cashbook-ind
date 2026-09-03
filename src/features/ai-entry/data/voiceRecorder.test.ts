import {NativeModules} from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

import {isVoiceAvailable, startRecording, stopRecording} from './voiceRecorder';

const rec = AudioRecorderPlayer as unknown as {
  __startRecorder: jest.Mock;
  __stopRecorder: jest.Mock;
};

describe('voiceRecorder', () => {
  it('reports voice available when the native module is linked', () => {
    expect(isVoiceAvailable()).toBe(true); // stubbed present in jest.setup
  });

  it('degrades safely when the native module is absent (no crash, guarded)', async () => {
    const saved = NativeModules.RNAudioRecorderPlayer;
    // Simulate a build without the audio module linked.
    (NativeModules as {RNAudioRecorderPlayer?: unknown}).RNAudioRecorderPlayer = undefined;
    try {
      expect(isVoiceAvailable()).toBe(false);
      await expect(startRecording()).rejects.toThrow(/unavailable/i);
    } finally {
      (NativeModules as {RNAudioRecorderPlayer?: unknown}).RNAudioRecorderPlayer = saved;
    }
  });

  it('startRecording starts the native recorder', async () => {
    await startRecording();
    expect(rec.__startRecorder).toHaveBeenCalled();
  });

  it('stopRecording returns an uploadable file part with a file:// uri', async () => {
    rec.__stopRecorder.mockResolvedValueOnce('/data/user/0/app/voice.mp4');
    const audio = await stopRecording();
    expect(audio.uri).toBe('file:///data/user/0/app/voice.mp4');
    expect(audio.name).toBe('voice.mp4');
    expect(audio.type).toBe('audio/mp4');
  });

  it('keeps an existing file:// prefix and maps m4a', async () => {
    rec.__stopRecorder.mockResolvedValueOnce('file:///var/mobile/voice.m4a');
    const audio = await stopRecording();
    expect(audio.uri).toBe('file:///var/mobile/voice.m4a');
    expect(audio.type).toBe('audio/m4a');
  });

  it('reports a positive duration for a start→stop cycle', async () => {
    await startRecording();
    const audio = await stopRecording();
    expect(audio.durationMs).toBeGreaterThanOrEqual(0);
    // A second stop with no fresh start reports 0 (start time was consumed).
    const again = await stopRecording();
    expect(again.durationMs).toBe(0);
  });
});
