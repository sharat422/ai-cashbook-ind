import {useQueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import {AppState} from 'react-native';

import {connectivity} from '@/services/network/connectivity';
import {syncPendingStock} from '@features/stock/data/stockQueue';
import {STOCK_KEY} from './hooks';

/** Headless: uploads offline stock entries on mount, on reconnect and on foreground. */
export function StockSyncManager(): null {
  const queryClient = useQueryClient();

  useEffect(() => {
    const sync = async () => {
      if ((await syncPendingStock()) > 0) {
        queryClient.invalidateQueries({queryKey: [STOCK_KEY]});
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
