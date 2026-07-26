/* Global Jest setup for the React Native app.
 * Mocks the native modules our logic layers touch so unit/integration tests
 * can run under Node without a device: AsyncStorage (Zustand persistence) and
 * NetInfo (connectivity). Individual tests override NetInfo return values.
 */

// Persisted Zustand stores write through AsyncStorage — use the official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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
