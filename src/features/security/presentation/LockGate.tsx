import React, {useEffect} from 'react';
import {AppState} from 'react-native';

import {useAppLockStore} from '@features/security/store/appLock.store';
import {UnlockScreen} from './UnlockScreen';

/**
 * Wraps the app and shows the PIN overlay whenever the lock is active. Re-locks
 * automatically when the app is backgrounded, so returning to it requires the
 * PIN again. On cold start the store rehydrates as locked (see the store).
 */
export function LockGate({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const hydrated = useAppLockStore(s => s.hydrated);
  const enabled = useAppLockStore(s => s.enabled);
  const locked = useAppLockStore(s => s.locked);
  const lock = useAppLockStore(s => s.lock);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      // Lock as the app leaves the foreground so the overlay is already up on return.
      if (next === 'background' || next === 'inactive') lock();
    });
    return () => sub.remove();
  }, [lock]);

  return (
    <>
      {children}
      {hydrated && enabled && locked ? <UnlockScreen /> : null}
    </>
  );
}
