import * as Keychain from 'react-native-keychain';

import {readAppLockSecret} from '@features/security/data/secureStore';
import {useAppLockStore} from './appLock.store';

const reset = async () => {
  // Clear the in-memory Keychain mock + reset store flags between tests.
  await Keychain.resetGenericPassword({service: 'smartcashbook.applock'});
  await Keychain.resetGenericPassword({service: 'smartcashbook.applock.bio'});
  useAppLockStore.setState({
    enabled: false,
    biometricEnabled: false,
    locked: false,
    hydrated: true,
  });
};

beforeEach(reset);

describe('app-lock store (Keystore/Keychain-backed)', () => {
  it('starts disabled and unlocked', () => {
    const s = useAppLockStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.locked).toBe(false);
  });

  it('setPin enables the lock and stores the secret in the secure store, not the app state', async () => {
    await useAppLockStore.getState().setPin('1234');
    const s = useAppLockStore.getState();
    expect(s.enabled).toBe(true);
    // The secret is NOT on the store object (would land in AsyncStorage).
    expect((s as unknown as {pinHash?: string}).pinHash).toBeUndefined();
    // It IS in the secure store, and never contains the raw PIN.
    const secret = await readAppLockSecret();
    expect(secret?.pinHash).toBeTruthy();
    expect(secret?.salt).toBeTruthy();
    expect(secret?.pinHash).not.toContain('1234');
  });

  it('verifyPin accepts the correct pin and unlocks', async () => {
    await useAppLockStore.getState().setPin('1234');
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().locked).toBe(true);
    await expect(useAppLockStore.getState().verifyPin('1234')).resolves.toBe(true);
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it('verifyPin rejects a wrong pin and stays locked', async () => {
    await useAppLockStore.getState().setPin('1234');
    useAppLockStore.getState().lock();
    await expect(useAppLockStore.getState().verifyPin('0000')).resolves.toBe(false);
    expect(useAppLockStore.getState().locked).toBe(true);
  });

  it('verifyPin returns false when no PIN is set', async () => {
    await expect(useAppLockStore.getState().verifyPin('1234')).resolves.toBe(false);
  });

  it('lock() is a no-op when the lock is disabled', () => {
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it('disableLock clears the secret and unlocks', async () => {
    await useAppLockStore.getState().setPin('1234');
    await useAppLockStore.getState().disableLock();
    const s = useAppLockStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.biometricEnabled).toBe(false);
    expect(s.locked).toBe(false);
    await expect(readAppLockSecret()).resolves.toBeNull();
  });

  it('enableBiometric enrols when supported, and unlockWithBiometrics unlocks', async () => {
    await useAppLockStore.getState().setPin('1234');
    await expect(useAppLockStore.getState().enableBiometric()).resolves.toBe(true);
    expect(useAppLockStore.getState().biometricEnabled).toBe(true);

    useAppLockStore.getState().lock();
    await expect(
      useAppLockStore.getState().unlockWithBiometrics(),
    ).resolves.toBe(true);
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it('unlockWithBiometrics is a no-op when biometrics are not enabled', async () => {
    await useAppLockStore.getState().setPin('1234');
    useAppLockStore.getState().lock();
    await expect(
      useAppLockStore.getState().unlockWithBiometrics(),
    ).resolves.toBe(false);
    expect(useAppLockStore.getState().locked).toBe(true);
  });

  it('enableBiometric returns false when the device has no biometrics', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValueOnce(null);
    await expect(useAppLockStore.getState().enableBiometric()).resolves.toBe(false);
    expect(useAppLockStore.getState().biometricEnabled).toBe(false);
  });
});
