import {useQueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import {AppState} from 'react-native';

import {connectivity} from '@/services/network/connectivity';
import {syncPendingVisits} from '@features/beats/data/visitQueue';
import {BEATS_KEY} from './hooks';

/** Headless: uploads offline visits on mount, on reconnect and on foreground. */
export function VisitSyncManager(): null {
  const queryClient = useQueryClient();

  useEffect(() => {
    const sync = async () => {
      if ((await syncPendingVisits()) > 0) {
        queryClient.invalidateQueries({queryKey: [BEATS_KEY]});
      }
    };
    void sync();
    const unsubscribe = connectivity.subscribe(online => online && void sync());
    const appSub = AppState.addEventListener('change', s => s === 'active' && void sync());
    return () => {
      unsubscribe();
      appSub.remove();
    };
  }, [queryClient]);

  return null;
}
