import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import {secureAuthStorage} from './secureAuthStorage';

const AUTH_SERVICE = 'smartcashbook.auth';
const LEGACY_KEY = 'auth-storage';

beforeEach(async () => {
  await AsyncStorage.clear();
  await Keychain.resetGenericPassword({service: AUTH_SERVICE});
});

describe('secureAuthStorage', () => {
  it('round-trips a value through the Keychain, not AsyncStorage', async () => {
    await secureAuthStorage.setItem(LEGACY_KEY, '{"token":"abc"}');

    // Stored in the Keychain under the auth service…
    const creds = await Keychain.getGenericPassword({service: AUTH_SERVICE});
    expect(creds && creds.password).toBe('{"token":"abc"}');
    // …and NOT written to plaintext AsyncStorage.
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();

    expect(await secureAuthStorage.getItem(LEGACY_KEY)).toBe('{"token":"abc"}');
  });

  it('migrates a legacy AsyncStorage session into the Keychain on first read', async () => {
    // Simulate a pre-upgrade install: session sitting in plaintext AsyncStorage.
    await AsyncStorage.setItem(LEGACY_KEY, '{"token":"legacy"}');

    // First read returns it (so the user is NOT logged out)…
    expect(await secureAuthStorage.getItem(LEGACY_KEY)).toBe('{"token":"legacy"}');
    // …moves it into the Keychain…
    const creds = await Keychain.getGenericPassword({service: AUTH_SERVICE});
    expect(creds && creds.password).toBe('{"token":"legacy"}');
    // …and deletes the plaintext copy.
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('returns null when nothing is stored and no legacy value exists', async () => {
    expect(await secureAuthStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('removeItem clears the Keychain entry', async () => {
    await secureAuthStorage.setItem(LEGACY_KEY, '{"token":"abc"}');
    await secureAuthStorage.removeItem(LEGACY_KEY);
    expect(await secureAuthStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
