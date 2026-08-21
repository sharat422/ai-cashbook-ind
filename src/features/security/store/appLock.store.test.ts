import {useAppLockStore} from './appLock.store';

const reset = () =>
  useAppLockStore.setState({
    enabled: false,
    pinHash: null,
    salt: null,
    locked: false,
    hydrated: true,
  });

beforeEach(reset);

describe('app-lock store', () => {
  it('starts disabled and unlocked', () => {
    const s = useAppLockStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.locked).toBe(false);
  });

  it('setPin enables the lock and stores a hash (never the raw pin)', () => {
    useAppLockStore.getState().setPin('1234');
    const s = useAppLockStore.getState();
    expect(s.enabled).toBe(true);
    expect(s.pinHash).toBeTruthy();
    expect(s.salt).toBeTruthy();
    expect(s.pinHash).not.toContain('1234');
  });

  it('verifyPin accepts the correct pin and unlocks', () => {
    useAppLockStore.getState().setPin('1234');
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().locked).toBe(true);
    expect(useAppLockStore.getState().verifyPin('1234')).toBe(true);
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it('verifyPin rejects a wrong pin and stays locked', () => {
    useAppLockStore.getState().setPin('1234');
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().verifyPin('0000')).toBe(false);
    expect(useAppLockStore.getState().locked).toBe(true);
  });

  it('lock() is a no-op when the lock is disabled', () => {
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it('disableLock clears the pin and unlocks', () => {
    useAppLockStore.getState().setPin('1234');
    useAppLockStore.getState().disableLock();
    const s = useAppLockStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.pinHash).toBeNull();
    expect(s.locked).toBe(false);
  });
});
