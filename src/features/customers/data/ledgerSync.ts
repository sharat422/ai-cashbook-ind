import {NetworkError} from '@api/client';
import {connectivity} from '@/services/network/connectivity';
import {ledgerLocal} from './ledger.local';
import {ledgerRemote} from './ledger.remote';
import {usePendingLedgerStore} from '../presentation/store/pendingLedger.store';

/**
 * Flush the offline ledger queue. Returns the customer ids that had entries
 * synced, so the caller can invalidate their ledger queries. Safe to call
 * repeatedly; no-ops when the queue is empty or the device is offline.
 */
export async function syncPendingLedger(): Promise<string[]> {
  const queue = ledgerLocal.all();
  if (queue.length === 0) return [];
  if (!(await connectivity.isOnline())) return [];

  const touched = new Set<string>();
  for (const item of queue) {
    try {
      const entry = await ledgerRemote.add(item.customerId, item.draft, item.localId);
      const store = usePendingLedgerStore.getState();
      store.cache(item.customerId, [...(store.cached[item.customerId] ?? []).filter(e => e.id !== entry.id), entry]);
      ledgerLocal.remove(item.localId);
      touched.add(item.customerId);
    } catch (err) {
      if (err instanceof NetworkError) break; // went offline again — stop
      // Server rejected it (e.g. validation): flag and move on.
      ledgerLocal.markFailed(
        item.localId,
        err instanceof Error ? err.message : 'Sync failed',
      );
    }
  }
  return [...touched];
}
