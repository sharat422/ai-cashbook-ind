import {useCallback, useEffect, useRef} from 'react';
import {AppState} from 'react-native';

import {connectivity} from '@/services/network/connectivity';
import {incomeUseCases} from '@features/income/di';

/**
 * Drives the offline queue: flushes pending income drafts on mount, whenever
 * connectivity is (re)gained, and when the app returns to the foreground.
 * Mount once near the app root via <OfflineSyncManager/>.
 */
export function useIncomeSync(): {syncNow: () => void} {
  const inFlight = useRef(false);

  const syncNow = useCallback(async () => {
    if (inFlight.current) return; // guard against overlapping syncs
    inFlight.current = true;
    try {
      await incomeUseCases.syncPending();
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    syncNow(); // attempt on mount

    const unsubscribeNet = connectivity.subscribe(online => {
      if (online) syncNow();
    });

    const appStateSub = AppState.addEventListener('change', status => {
      if (status === 'active') syncNow();
    });

    return () => {
      unsubscribeNet();
      appStateSub.remove();
    };
  }, [syncNow]);

  return {syncNow};
}
