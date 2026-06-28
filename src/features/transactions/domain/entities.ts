/**
 * Domain entities for the Transaction History feature. Transactions are the
 * unified view over income + expense entries. Pure types — no framework imports.
 */
import {EXPENSE_CATEGORIES} from '@features/expense/domain/entities';
import {INCOME_CATEGORIES} from '@features/income/domain/entities';

export type TransactionType = 'income' | 'expense';

/** A single ledger entry (income or expense) as shown in history. */
export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Present on expenses (who was paid). */
  vendor?: string;
  notes?: string;
  createdAt: string;
}

export type SortField = 'date' | 'amount';
export type SortDirection = 'asc' | 'desc';

export interface TransactionSort {
  field: SortField;
  direction: SortDirection;
}

/** User-controlled filters applied to the history list. */
export interface TransactionFilters {
  /** Free-text search over category / vendor / notes. */
  search: string;
  /** 'all' or a specific type. */
  type: TransactionType | 'all';
  /** Selected category names; empty = all categories. */
  categories: string[];
  /** Inclusive date range (ISO YYYY-MM-DD); null = unbounded. */
  dateFrom: string | null;
  dateTo: string | null;
  sort: TransactionSort;
}

/** Everything the data layer needs to fetch one page. */
export interface TransactionQuery extends TransactionFilters {
  /** Opaque cursor for the next page; null/undefined for the first page. */
  cursor: string | null;
  limit: number;
}

/** One page of results plus the cursor to fetch the next. */
export interface TransactionPage {
  items: Transaction[];
  /** Cursor for the next page, or null when there are no more. */
  nextCursor: string | null;
  /** Total matching the current filters (for the results count header). */
  total: number;
}

/** All selectable categories across both transaction types (de-duplicated). */
export const ALL_CATEGORIES: string[] = Array.from(
  new Set<string>([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]),
);

/** Default, unfiltered state: newest first. */
export function defaultFilters(): TransactionFilters {
  return {
    search: '',
    type: 'all',
    categories: [],
    dateFrom: null,
    dateTo: null,
    sort: {field: 'date', direction: 'desc'},
  };
}

/** Count of non-default filters — drives the "Filters (n)" badge. */
export function activeFilterCount(filters: TransactionFilters): number {
  let count = 0;
  if (filters.type !== 'all') count += 1;
  if (filters.categories.length > 0) count += 1;
  if (filters.dateFrom || filters.dateTo) count += 1;
  return count;
}
