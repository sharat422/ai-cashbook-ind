import {apiRequest} from '@api/client';
import {useVisitQueue} from '@features/beats/data/visitQueue';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useStockQueue} from '@features/stock/data/stockQueue';

/** Which queue an entry waits in (the server's name for it). IM5. */
export type QueueKind = 'income' | 'expense' | 'ledger' | 'visit' | 'stock' | 'bill';
export type MoneyKind = 'income' | 'expense' | 'ledger';

export interface Fix {
  amount: number;
  date: string;
  notes?: string;
  /** Udhar: invoice number; payment: reference / UTR. */
  reference?: string;
}

const retryable = {lastError: undefined, retryCount: 0};

/**
 * Fix a failed money entry where it waits (IM5): same client id, error cleared,
 * so the next sync sends it and the server creates it exactly once (it dedupes
 * on the client id). Nothing is copied into a second queue.
 */
export function requeueEdited(kind: MoneyKind, localId: string, fix: Fix): void {
  const {amount, date, notes} = fix;
  if (kind === 'ledger') {
    usePendingLedgerStore.setState(s => ({
      entries: s.entries.map(q => (q.localId !== localId ? q : {
        ...q, ...retryable,
        draft: {...q.draft, amount, date, notes,
          ...(q.draft.type === 'payment' ? {referenceNumber: fix.reference} : {invoiceNumber: fix.reference})},
      })),
    }));
    return;
  }
  const store = kind === 'income' ? useIncomeStore : useExpenseStore;
  (store.setState as (fn: (s: any) => object) => void)(s => ({
    queue: s.queue.map((q: {localId: string; draft: object}) =>
      (q.localId === localId ? {...q, ...retryable, draft: {...q.draft, amount, date, notes}} : q)),
    entries: s.entries.map((e: {id: string}) => (e.id === localId ? {...e, amount, date, notes} : e)),
  }));
}

/**
 * Owner only (IM5). The server first records the client id (so a late retry of
 * this entry can't create it) and writes the audit row; only then does the entry
 * leave this phone. Needs a connection; an entry already on the server is refused.
 */
export async function discardQueued(kind: QueueKind, clientId: string, amount: number | null,
  summary: string): Promise<void> {
  await apiRequest('/sync/discard', {method: 'POST', body: {
    clientId, kind, summary: summary.slice(0, 200),
    amount: amount === null ? null : Math.round(amount * 100) / 100,
  }});
  if (kind === 'ledger') {
    usePendingLedgerStore.setState(s => ({entries: s.entries.filter(q => q.localId !== clientId)}));
  } else if (kind === 'income' || kind === 'expense') {
    const store = kind === 'income' ? useIncomeStore : useExpenseStore;
    (store.setState as (fn: (s: any) => object) => void)(s => ({
      queue: s.queue.filter((q: {localId: string}) => q.localId !== clientId),
      entries: s.entries.filter((e: {id: string}) => e.id !== clientId),
    }));
  } else if (kind === 'visit') {
    useVisitQueue.getState().remove(clientId);
  } else {
    useStockQueue.setState(s => ({pending: s.pending.filter(e => e.input.clientId !== clientId)}));
  }
}
