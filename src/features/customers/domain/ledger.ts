/**
 * Customer ledger domain — credit (customer owes more) and payment (received,
 * reduces dues) entries, plus the running-balance computation. Pure types/logic.
 */
import type {Attachment} from '@/shared/types/attachment';

export type {Attachment};

export type LedgerEntryType = 'credit' | 'payment';

/** How a payment was received. */
export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'cheque';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank Transfer',
  cheque: 'Cheque',
};

/** Sync state of an entry created locally relative to the backend. */
export type LedgerSyncStatus = 'synced' | 'pending';

/** A raw ledger entry as stored/returned by the backend. */
export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  /** Always positive; the type decides the sign. */
  amount: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  invoiceNumber?: string;
  notes?: string;
  /** Payment-only: how it was received and any reference (UPI ref / cheque no). */
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  /** Local file URI while pending; remote URL once uploaded. */
  attachmentUrl?: string;
  attachment?: Attachment | null;
  createdAt: string;
  /** Defaults to 'synced'; 'pending' for entries queued offline. */
  syncStatus?: LedgerSyncStatus;
}

/** A ledger entry with the running outstanding balance after it. */
export interface LedgerEntryView extends LedgerEntry {
  balance: number;
}

/** The full ledger for a customer, ready for the UI. */
export interface CustomerLedger {
  /** Latest activity first (for the timeline). */
  entries: LedgerEntryView[];
  /** Current outstanding (credits − payments). */
  outstanding: number;
  totalCredit: number;
  totalPayment: number;
}

/** What the user enters when adding a credit or recording a payment. */
export interface LedgerEntryDraft {
  type: LedgerEntryType;
  amount: number;
  date: string;
  invoiceNumber?: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  attachment?: Attachment | null;
}

/** Chronological signed delta of an entry on the outstanding balance. */
function signedAmount(entry: LedgerEntry): number {
  return entry.type === 'credit' ? entry.amount : -entry.amount;
}

/**
 * Build the displayable ledger from raw entries: sort chronologically, attach
 * the running balance after each, then return newest-first for the timeline.
 */
export function buildLedger(entries: LedgerEntry[]): CustomerLedger {
  const chronological = [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });

  let balance = 0;
  let totalCredit = 0;
  let totalPayment = 0;
  const withBalance: LedgerEntryView[] = chronological.map(entry => {
    balance += signedAmount(entry);
    if (entry.type === 'credit') totalCredit += entry.amount;
    else totalPayment += entry.amount;
    return {...entry, balance};
  });

  return {
    entries: withBalance.reverse(), // newest first
    outstanding: balance,
    totalCredit,
    totalPayment,
  };
}
