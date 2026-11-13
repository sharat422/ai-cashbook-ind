import {Alert} from 'react-native';

import {syncPendingVisits, useVisitQueue} from '@features/beats/data/visitQueue';
import {syncPendingLedger} from '@features/customers/data/ledgerSync';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {expenseUseCases} from '@features/expense/di';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {incomeUseCases} from '@features/income/di';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {syncPendingStock, useStockQueue} from '@features/stock/data/stockQueue';
import type {TranslateFn} from '@/i18n';
import {syncCustomerEdits, useCustomerEdits} from './customerEdits';

/** Every offline queue on the phone. "failed" = the server refused it (it stays queued). */
export interface SyncCounts {
  pending: number;
  failed: number;
  conflicts: number;
}
export type SyncState = 'synced' | 'pending' | 'failed' | 'conflict';

type Queued = {lastError?: string}[];

function tally(queues: Queued[], conflicts: number): SyncCounts {
  const all = queues.flat();
  const failed = all.filter(q => q.lastError).length;
  return {pending: all.length - failed, failed, conflicts};
}

export function syncCountsNow(): SyncCounts {
  return tally(
    [
      useIncomeStore.getState().queue,
      useExpenseStore.getState().queue,
      usePendingLedgerStore.getState().entries,
      useVisitQueue.getState().pending,
      useCustomerEdits.getState().pending,
      useStockQueue.getState().pending,
    ],
    useCustomerEdits.getState().conflicts.length + useStockQueue.getState().conflicts.length,
  );
}

export function useSyncCounts(): SyncCounts {
  const income = useIncomeStore(s => s.queue);
  const expense = useExpenseStore(s => s.queue);
  const ledger = usePendingLedgerStore(s => s.entries);
  const visits = useVisitQueue(s => s.pending);
  const edits = useCustomerEdits(s => s.pending);
  const stock = useStockQueue(s => s.pending);
  const conflicts = useCustomerEdits(s => s.conflicts.length) + useStockQueue(s => s.conflicts.length);
  return tally([income, expense, ledger, visits, edits, stock], conflicts);
}

export function syncState(c: SyncCounts): SyncState {
  if (c.conflicts > 0) return 'conflict';
  if (c.failed > 0) return 'failed';
  if (c.pending > 0) return 'pending';
  return 'synced';
}

/** "Sync now": every queue, one after another (each already shares a running sync). */
export async function syncEverything(): Promise<void> {
  await incomeUseCases.syncPending();
  await expenseUseCases.syncPending();
  await syncPendingLedger();
  await syncPendingVisits();
  await syncCustomerEdits();
  await syncPendingStock();
}

/** Logging out wipes this phone's queues, so say plainly what would be lost. */
export function confirmLogout(t: TranslateFn, logout: () => void): void {
  const c = syncCountsNow();
  const unsynced = c.pending + c.failed + c.conflicts;
  Alert.alert(
    t('common.logoutConfirmTitle'),
    unsynced > 0 ? t('sync.logoutUnsynced', {count: unsynced}) : t('common.logoutConfirmMsg'),
    [
      {text: t('common.cancel'), style: 'cancel'},
      {text: unsynced > 0 ? t('sync.logoutAnyway') : t('common.logout'), style: 'destructive', onPress: logout},
    ],
  );
}
