/* Global Jest setup for the React Native app.
 * Mocks the native modules our logic layers touch so unit/integration tests
 * can run under Node without a device: AsyncStorage (Zustand persistence) and
 * NetInfo (connectivity). Individual tests override NetInfo return values.
 */

// Persisted Zustand stores write through AsyncStorage — use the official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// react-native-config reads a native .env at build time; under Jest there is no
// native module. An empty object is enough — src/config/env.ts supplies a
// fallback for every key.
jest.mock('react-native-config', () => ({__esModule: true, default: {}}));

// react-native-keychain wraps the Android Keystore / iOS Keychain — no native
// module under Jest. This in-memory stand-in lets the app-lock logic be tested;
// biometrics default to "supported + succeeds" and can be overridden per-test.
jest.mock('react-native-keychain', () => {
  const store = {};
  return {
    ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly'},
    ACCESS_CONTROL: {BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'bioOrPasscode'},
    BIOMETRY_TYPE: {FACE_ID: 'FaceID', TOUCH_ID: 'TouchID', FINGERPRINT: 'Fingerprint'},
    setGenericPassword: jest.fn(async (username, password, opts = {}) => {
      store[opts.service || 'default'] = {username, password};
      return true;
    }),
    getGenericPassword: jest.fn(async (opts = {}) => store[opts.service || 'default'] || false),
    resetGenericPassword: jest.fn(async (opts = {}) => {
      delete store[opts.service || 'default'];
      return true;
    }),
    getSupportedBiometryType: jest.fn(async () => 'Fingerprint'),
    __store: store,
  };
});

// Mark the audio native module as "linked" so isVoiceAvailable() is true in tests
// (the recorder methods themselves are stubbed via the module mock below).
try {
  const {NativeModules} = require('react-native');
  NativeModules.RNAudioRecorderPlayer = NativeModules.RNAudioRecorderPlayer || {};
} catch (e) {
  // ignore
}

// jail-monkey (root/jailbreak detection) is native; default to a clean device.
jest.mock('jail-monkey', () => ({
  __esModule: true,
  default: {isJailBroken: jest.fn(() => false)},
}));

// react-native-audio-recorder-player v3 exports a class; stub it so every
// instance shares the same jest.fn recorders (tests read them off the class).
jest.mock('react-native-audio-recorder-player', () => {
  const startRecorder = jest.fn(async () => '/tmp/voice.m4a');
  const stopRecorder = jest.fn(async () => '/tmp/voice.m4a');
  function AudioRecorderPlayer() {
    return {
      startRecorder,
      stopRecorder,
      addRecordBackListener: jest.fn(),
      removeRecordBackListener: jest.fn(),
    };
  }
  AudioRecorderPlayer.__startRecorder = startRecorder;
  AudioRecorderPlayer.__stopRecorder = stopRecorder;
  return {
    __esModule: true,
    default: AudioRecorderPlayer,
    // Named enums used to build the AudioSet (16 kHz mono AAC + noise source).
    AudioSourceAndroidType: {VOICE_RECOGNITION: 6},
    OutputFormatAndroidType: {MPEG_4: 2},
    AudioEncoderAndroidType: {AAC: 3},
    AVEncoderAudioQualityIOSType: {high: 96},
    AVEncodingOption: {aac: 'aac'},
  };
});

// react-native-get-sms-android is an Android-only native module; provide a
// stub so the reader logic can be unit-tested. Tests override `list` per case.
jest.mock('react-native-get-sms-android', () => ({
  __esModule: true,
  default: {list: jest.fn()},
}));

// Connectivity wrapper calls NetInfo.fetch()/addEventListener(). Default to
// "online"; tests that exercise the offline path override fetch per-case.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() =>
      Promise.resolve({isConnected: true, isInternetReachable: true}),
    ),
    addEventListener: jest.fn(() => () => {}),
  },
  fetch: jest.fn(() =>
    Promise.resolve({isConnected: true, isInternetReachable: true}),
  ),
  addEventListener: jest.fn(() => () => {}),
}));
