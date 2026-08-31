import AudioRecorderPlayer from 'react-native-audio-recorder-player';

import {startRecording, stopRecording} from './voiceRecorder';

const rec = AudioRecorderPlayer as unknown as {
  startRecorder: jest.Mock;
  stopRecorder: jest.Mock;
};

describe('voiceRecorder', () => {
  it('startRecording starts the native recorder', async () => {
    await startRecording();
    expect(rec.startRecorder).toHaveBeenCalled();
  });

  it('stopRecording returns an uploadable file part with a file:// uri', async () => {
    rec.stopRecorder.mockResolvedValueOnce('/data/user/0/app/voice.mp4');
    const audio = await stopRecording();
    expect(audio.uri).toBe('file:///data/user/0/app/voice.mp4');
    expect(audio.name).toBe('voice.mp4');
    expect(audio.type).toBe('audio/mp4');
  });

  it('keeps an existing file:// prefix and maps m4a', async () => {
    rec.stopRecorder.mockResolvedValueOnce('file:///var/mobile/voice.m4a');
    const audio = await stopRecording();
    expect(audio.uri).toBe('file:///var/mobile/voice.m4a');
    expect(audio.type).toBe('audio/m4a');
  });
});
