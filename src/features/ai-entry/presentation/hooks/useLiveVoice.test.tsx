import React from 'react';
import {act, create} from 'react-test-renderer';
import {createLiveVoice} from '../../data/liveVoice';
import {useLiveVoice} from './useLiveVoice';

jest.mock('../../data/liveVoice', () => ({createLiveVoice: jest.fn()}));
jest.mock('../../data/voiceRecorder', () => ({
  ensureMicPermission: jest.fn(async () => true),
}));
jest.mock('@react-navigation/native', () => ({useFocusEffect: jest.fn()}));

it('manual Stop immediately unlocks the text and ignores late transcription callbacks', async () => {
  const callbacks = {
    language: 'hi', onText: jest.fn(), onComplete: jest.fn(), onError: jest.fn(),
  };
  let events!: Parameters<typeof createLiveVoice>[0];
  let release!: () => void;
  const cancel = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const finalize = jest.fn();
  (createLiveVoice as jest.Mock).mockImplementation(options => {
    events = options;
    options.onState('recording');
    return {cancel, stop: finalize};
  });
  let voice!: ReturnType<typeof useLiveVoice>;
  function Harness() {
    voice = useLiveVoice(callbacks);
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness />); });
  await act(async () => { await voice.start(); });
  act(() => { events.onText('Ramesh paid 500'); });
  expect(voice.state).toBe('recording');

  act(() => { voice.stop(); });
  expect(voice.state).toBe('idle'); // Does not wait for network/native cleanup.
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(finalize).not.toHaveBeenCalled();
  act(() => {
    events.onText('late revision');
    events.onComplete('late final');
    events.onError(new Error('closed'));
  });
  expect(callbacks.onText).toHaveBeenCalledTimes(1);
  expect(callbacks.onText).toHaveBeenLastCalledWith('Ramesh paid 500');
  expect(callbacks.onComplete).not.toHaveBeenCalled();
  expect(callbacks.onError).not.toHaveBeenCalled();
  await act(async () => { release(); });
  act(() => { tree.unmount(); });
});
