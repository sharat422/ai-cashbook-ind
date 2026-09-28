import {NativeModules} from 'react-native';
import {createLiveVoice} from './liveVoice';

const mockListeners = new Map<string, (value: string) => void>();
jest.mock('react-native', () => ({
  NativeModules: {VoicePcm: {start: jest.fn(), stop: jest.fn()}},
  NativeEventEmitter: jest.fn(() => ({
    addListener: (name: string, callback: (value: string) => void) => {
      mockListeners.set(name, callback);
      return {remove: () => mockListeners.delete(name)};
    },
  })),
}));
jest.mock('@config/env', () => ({API_ROOT: 'https://cashbook.test/api/v1'}));
jest.mock('@store/auth.store', () => ({
  useAuthStore: {getState: () => ({token: 'user-token'})},
}));
jest.mock('@api/client', () => ({
  ApiError: class extends Error {
    status: number;
    constructor(code: number, message: string) {
      super(message);
      this.status = code;
    }
  },
}));

class FakeSocket {
  static OPEN = 1;
  static latest: FakeSocket;
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (event: {data: string}) => Promise<void>;
  onerror?: () => void;
  onclose?: (event: {code: number}) => void;
  constructor(public url: string) {
    FakeSocket.latest = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close = jest.fn();
  message(data: unknown) {
    return this.onmessage?.({data: JSON.stringify(data)});
  }
}

const callbacks = () => ({
  language: 'hi',
  onState: jest.fn(),
  onText: jest.fn(),
  onComplete: jest.fn(),
  onError: jest.fn(),
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const originalSocket = global.WebSocket;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockListeners.clear();
  NativeModules.VoicePcm.start.mockResolvedValue(undefined);
  NativeModules.VoicePcm.stop.mockResolvedValue(undefined);
  global.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  jest.useRealTimers();
  global.WebSocket = originalSocket;
});

it('waits for ready, replaces partials, and completes only on a final transcript and normal close', async () => {
  const cb = callbacks();
  const session = createLiveVoice(cb);
  const socket = FakeSocket.latest;
  expect(socket.url).toBe('wss://cashbook.test/api/v1/voice/live');
  socket.onopen?.();
  expect(socket.sent[0]).toEqual({token: 'user-token', language: 'hi'});
  expect(NativeModules.VoicePcm.start).not.toHaveBeenCalled();
  await socket.message({type: 'ready'});
  mockListeners.get('voicePcmData')?.('AAAA');
  await socket.message({
    type: 'transcript',
    transcript: 'Ramesh 50',
    final: false,
  });
  await socket.message({
    type: 'transcript',
    transcript: 'Ramesh 500',
    final: false,
  });
  expect(cb.onText.mock.calls.map(call => call[0])).toEqual([
    'Ramesh 50',
    'Ramesh 500',
  ]);
  await session.stop();
  expect(socket.sent.at(-1)).toEqual({type: 'endStream'});
  await socket.message({
    type: 'transcript',
    transcript: 'Ramesh 500.',
    final: true,
  });
  expect(cb.onComplete).not.toHaveBeenCalled();
  socket.onclose?.({code: 1000});
  await flush();
  expect(cb.onComplete).toHaveBeenCalledWith('Ramesh 500.');
  expect(mockListeners.size).toBe(0);
});

it('drains native audio before endStream, then ignores subsequent frames', async () => {
  const session = createLiveVoice(callbacks());
  const socket = FakeSocket.latest;
  await socket.message({type: 'ready'});
  let stopped!: () => void;
  NativeModules.VoicePcm.stop.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        stopped = resolve;
      }),
  );
  const stopping = session.stop();
  mockListeners.get('voicePcmData')?.('AAAA');
  expect(socket.sent).toEqual([{type: 'audio', audio: 'AAAA'}]);
  stopped();
  await stopping;
  mockListeners.get('voicePcmData')?.('BBBB');
  expect(socket.sent).toEqual([
    {type: 'audio', audio: 'AAAA'},
    {type: 'endStream'},
  ]);
  await session.cancel();
});

it('preserves a partial on disconnect but never parses it as final', async () => {
  const cb = callbacks();
  createLiveVoice(cb);
  const socket = FakeSocket.latest;
  await socket.message({type: 'ready'});
  await socket.message({
    type: 'transcript',
    transcript: 'Ramesh',
    final: false,
  });
  socket.onclose?.({code: 1006});
  await flush();
  expect(cb.onError).toHaveBeenCalledTimes(1);
  expect(cb.onComplete).not.toHaveBeenCalled();
  expect(NativeModules.VoicePcm.stop).toHaveBeenCalled();
  expect(cb.onText).toHaveBeenLastCalledWith('Ramesh');
});

it('releases capture on timeout or cancellation without late completion', async () => {
  const cb = callbacks();
  const session = createLiveVoice(cb);
  await FakeSocket.latest.message({type: 'ready'});
  await session.cancel();
  await FakeSocket.latest.message({
    type: 'transcript',
    transcript: 'late',
    final: true,
  });
  jest.advanceTimersByTime(160_000);
  await flush();
  expect(cb.onError).not.toHaveBeenCalled();
  expect(cb.onComplete).not.toHaveBeenCalled();
  const next = callbacks();
  createLiveVoice(next);
  jest.advanceTimersByTime(30_000);
  await flush();
  expect(next.onError).toHaveBeenCalledTimes(1);
});

it('reports native microphone startup failures', async () => {
  NativeModules.VoicePcm.start.mockRejectedValueOnce(
    new Error('Microphone denied'),
  );
  const cb = callbacks();
  createLiveVoice(cb);
  await FakeSocket.latest.message({type: 'ready'});
  await flush();
  expect(cb.onError.mock.calls[0][0].message).toBe('Microphone denied');
  expect(mockListeners.size).toBe(0);
});

it('bounds audio queued behind a stalled network', async () => {
  const cb = callbacks();
  createLiveVoice(cb);
  await FakeSocket.latest.message({type: 'ready'});
  const frame = 'A'.repeat(5120); // 80 ms of PCM24
  for (let i = 0; i < 64; i++) {
    mockListeners.get('voicePcmData')?.(frame);
  }
  await flush();
  expect(cb.onError).toHaveBeenCalledTimes(1);
  expect(cb.onComplete).not.toHaveBeenCalled();
  expect(mockListeners.size).toBe(0);
});
