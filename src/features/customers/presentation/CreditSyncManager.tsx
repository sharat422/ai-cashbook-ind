import {useQueryClient} from '@tanstack/react-query';
import {useCallback, useEffect, useRef} from 'react';
import {AppState} from 'react-native';

import {connectivity} from '@/services/network/connectivity';
import {syncPendingLedger} from '@features/customers/data/ledgerSync';
import {CUSTOMERS_KEY} from '@features/customers/presentation/hooks/useCustomers';
import {LEDGER_KEY} from '@features/customers/presentation/hooks/useCustomerLedger';

/**
 * Headless: flushes offline ledger (Udhaar) entries on mount, on reconnect, and
 * on foreground, then invalidates the affected ledger queries so the timeline
 * swaps the optimistic pending entries for the synced ones. Mount inside the
 * QueryProvider tree.
 */
export function CreditSyncManager(): null {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const touched = await syncPendingLedger();
      if (touched.length > 0) {
        queryClient.invalidateQueries({queryKey: [CUSTOMERS_KEY]});
        touched.forEach(id =>
          queryClient.invalidateQueries({queryKey: [LEDGER_KEY, id]}),
        );
      }
    } finally {
      inFlight.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    void sync();
    const unsubscribe = connectivity.subscribe(online => online && void sync());
    const appSub = AppState.addEventListener('change', status => {
      if (status === 'active') void sync();
    });
    return () => {
      unsubscribe();
      appSub.remove();
    };
  }, [sync]);

  return null;
}
