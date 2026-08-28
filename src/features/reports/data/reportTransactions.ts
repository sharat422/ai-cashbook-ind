import {NetworkError} from '@api/client';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import type {ReportTxn} from '@features/reports/domain/entities';
import {transactionRemote} from '@features/transactions/data/transaction.remote';
import type {TransactionQuery} from '@features/transactions/domain/entities';

export type {ReportTxn};

export interface ReportTxnResult {
  items: ReportTxn[];
  source: 'remote' | 'local';
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 40; // safety cap: up to 20k rows per export

function baseQuery(from: string, to: string): TransactionQuery {
  return {
    search: '',
    type: 'all',
    categories: [],
    dateFrom: from,
    dateTo: to,
    sort: {field: 'date', direction: 'asc'},
    cursor: null,
    limit: PAGE_LIMIT,
  };
}

/** Offline fallback: build the list from locally-stored entries (incl. pending). */
function fromLocalStores(from: string, to: string): ReportTxn[] {
  const inRange = (d: string) => d >= from && d <= to;
  const incomes = useIncomeStore.getState().entries.filter(e => inRange(e.date));
  const expenses = useExpenseStore.getState().entries.filter(e => inRange(e.date));

  const rows: ReportTxn[] = [
    ...incomes.map(e => ({
      type: 'income' as const,
      date: e.date,
      category: e.category,
      party: '',
      amount: e.amount,
      notes: e.notes ?? '',
    })),
    ...expenses.map(e => ({
      type: 'expense' as const,
      date: e.date,
      category: e.category,
      party: e.vendor ?? '',
      amount: e.amount,
      notes: e.notes ?? '',
    })),
  ];
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * All transactions in [from, to] for export. Pages through the backend; on a
 * NetworkError (offline/timeout) falls back to on-device entries, mirroring the
 * report summary's offline behaviour.
 */
export async function getReportTransactions(
  from: string,
  to: string,
): Promise<ReportTxnResult> {
  try {
    const items: ReportTxn[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await transactionRemote.getPage({
        ...baseQuery(from, to),
        cursor,
      });
      for (const t of res.items) {
        items.push({
          type: t.type,
          date: t.date,
          category: t.category,
          party: t.vendor ?? '',
          amount: t.amount,
          notes: t.notes ?? '',
        });
      }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return {items, source: 'remote'};
  } catch (err) {
    if (err instanceof NetworkError) {
      return {items: fromLocalStores(from, to), source: 'local'};
    }
    throw err;
  }
}
