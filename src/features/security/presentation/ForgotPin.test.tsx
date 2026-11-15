/**
 * Forgot the app-lock PIN: the lock is turned off and the person logs in again
 * with an OTP (the same check as every app start). When the lock came up over a
 * logged-in session, it also logs out, and the warning says how many entries
 * waiting to sync that deletes.
 */
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useAppLockStore} from '@features/security/store/appLock.store';
import {useAuthStore} from '@store/auth.store';
import {UnlockScreen} from './UnlockScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@features/sync/syncStatus', () => ({syncCountsNow: () => ({pending: 2, failed: 1, conflicts: 0})}));

const disableLock = jest.fn(() => Promise.resolve());
const logout = jest.fn();

async function forgot(loggedIn: boolean): Promise<{message: string}> {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useAppLockStore.setState({disableLock, biometricEnabled: false} as never);
  useAuthStore.setState({token: loggedIn ? 'tok' : null, logout} as never);
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<UnlockScreen />); });
  await act(async () => { r.root.findByProps({testID: 'unlock-forgot'}).props.onPress(); });
  const [, message, buttons] = alert.mock.calls[0] as [string, string, {onPress?: () => void}[]];
  await act(async () => { buttons[1].onPress?.(); }); // "Reset PIN"
  act(() => r.unmount());
  alert.mockRestore();
  return {message};
}

beforeEach(() => jest.clearAllMocks());

test('at app start: the lock goes, then the normal OTP login', async () => {
  const {message} = await forgot(false);
  expect(disableLock).toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  expect(message).toContain('OTP');
  expect(message).not.toContain('deleted');
});

test('over a logged-in session: also logs out, and says what waiting entries it deletes', async () => {
  const {message} = await forgot(true);
  expect(disableLock).toHaveBeenCalled();
  expect(logout).toHaveBeenCalled();
  expect(message).toContain('3 entries');
});
