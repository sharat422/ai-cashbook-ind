/**
 * Domain entities for the Income feature. Pure data + types, no framework
 * imports — this is the innermost layer of the feature's clean architecture.
 */

export const INCOME_CATEGORIES = [
  'Sales',
  'Services',
  'Interest',
  'Refund',
  'Investment',
  'Other',
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

// Attachment + SyncStatus are shared across features.
export type {Attachment, SyncStatus} from '@/shared/types/attachment';
import type {Attachment, SyncStatus} from '@/shared/types/attachment';

/** What the user fills in on the form. */
export interface IncomeDraft {
  /** Amount in whole INR (rupees). */
  amount: number;
  category: IncomeCategory;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  notes?: string;
  attachment?: Attachment | null;
}

/** A persisted income entry. */
export interface Income extends IncomeDraft {
  /** Server id when synced; a temporary local id while pending. */
  id: string;
  createdAt: string;
  syncStatus: SyncStatus;
  /** URL of the uploaded attachment, if any. */
  attachmentUrl?: string;
}
