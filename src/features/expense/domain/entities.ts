/**
 * Domain entities for the Expense feature. Pure data + types, no framework
 * imports — the innermost layer of the feature's clean architecture.
 */
import type {Attachment, SyncStatus} from '@/shared/types/attachment';

export type {Attachment, SyncStatus};

/**
 * The one list of expense categories: the form, Quick add, recurring expenses,
 * receipt scan, AI entry and the AI categorizer all offer these. The server's
 * ai.EXPENSE_CATEGORIES is the same list (backend/tests/test_expense_categories.py).
 * "Purchases" is also what a stock purchase's expense is booked as.
 */
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Salary',
  'Fuel',
  'Food',
  'Travel',
  'Utilities',
  'Purchases',
  'Marketing',
  'Miscellaneous',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** What the user fills in on the form. */
export interface ExpenseDraft {
  /** Amount in whole INR (rupees). */
  amount: number;
  category: ExpenseCategory;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Who was paid. */
  vendor: string;
  notes?: string;
  attachment?: Attachment | null;
}

/** A persisted expense entry. */
export interface Expense extends ExpenseDraft {
  /** Server id when synced; a temporary local id while pending. */
  id: string;
  createdAt: string;
  syncStatus: SyncStatus;
  /** URL of the uploaded attachment, if any. */
  attachmentUrl?: string;
  /** Set on a stock purchase's expense (it goes only by reversing the purchase in Stock). */
  purchaseId?: string;
}
