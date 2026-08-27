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

// jail-monkey (root/jailbreak detection) is native; default to a clean device.
jest.mock('jail-monkey', () => ({
  __esModule: true,
  default: {isJailBroken: jest.fn(() => false)},
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
