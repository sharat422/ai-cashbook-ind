/**
 * Customer ledger domain — credit (customer owes more) and payment (received,
 * reduces dues) entries, plus the running-balance computation. Pure types/logic.
 */
import type {Attachment} from '@/shared/types/attachment';

export type {Attachment};

export type LedgerEntryType = 'credit' | 'payment';

/** How a payment was received. */
export type PaymentMethod =
  | 'cash'
  | 'upi'
  | 'bank'
  | 'card'
  | 'cheque'
  | 'credit'
  | 'other';

/** Display order for method selectors. */
export const PAYMENT_METHODS: PaymentMethod[] = [
  'cash',
  'upi',
  'bank',
  'card',
  'cheque',
  'credit',
  'other',
];

const UTR_RE = /^[A-Za-z0-9/_.-]{6,40}$/;

/** Server rule, mirrored here: a UPI payment must carry its UTR / transaction
 *  ID (6–40 letters or digits) so it can be matched to the bank statement. */
export function isUtrMissing(method: PaymentMethod | undefined, reference?: string): boolean {
  return method === 'upi' && !UTR_RE.test((reference ?? '').replace(/\s/g, ''));
}

/** Sync state of an entry created locally relative to the backend. */
export type LedgerSyncStatus = 'synced' | 'pending';

/** A raw ledger entry as stored/returned by the backend. */
export interface LedgerEntry {
  clientId?: string;
  id: string;
  type: LedgerEntryType;
  /** Always positive; the type decides the sign. */
  amount: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  invoiceNumber?: string;
  /** GST invoices only: a draft has no number and doesn't count yet; a
   *  cancelled one no longer counts; an issued one is locked. */
  gstStatus?: GstStatus;
  notes?: string;
  /** Payment-only: how it was received and any reference (UPI ref / cheque no). */
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  /** Cheque: the drawer's bank and account (a cheque number alone repeats). */
  chequeBank?: string;
  chequeAccount?: string;
  /** Set by the server when a bank/cheque reference repeats an earlier
   *  payment: saved anyway, the person is told to check it. */
  warning?: DuplicateReference;
  /** Local file URI while pending; remote URL once uploaded. */
  attachmentUrl?: string;
  attachment?: Attachment | null;
  createdAt: string;
  /** Defaults to 'synced'; 'pending' for entries queued offline. */
  syncStatus?: LedgerSyncStatus;
  /** An item bill waiting in the offline queue (its line count): no amount yet. */
  queuedBillLines?: number;
}

export interface DuplicateReference {
  entryId: string;
  customerName: string;
  amount: string;
  date: string;
  /** The earlier cheque was saved with its number only (before bank and account were asked for). */
  numberOnly?: boolean;
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
  chequeBank?: string;
  chequeAccount?: string;
  attachment?: Attachment | null;
  /** Set when recorded from a beat day-list; feeds that beat's daily close. */
  beatId?: string;
  /** Credit only: a GST invoice. The server computes and saves the tax split;
   *  `amount` is then the price (with or without GST, per `priceIncludesGst`). */
  gst?: GstInvoiceInput;
}

export interface GstInvoiceInput {
  rate: string;
  hsn: string;
  /** Quantity and unit (UQC) of the line — required on a GST invoice. */
  quantity: string;
  uqc: string;
  priceIncludesGst: boolean;
  customerGstin?: string;
  /** Customer's state when they have no GSTIN; defaults to the seller's. */
  placeOfSupply?: string;
  /** A cash GST sale: the invoice is paid in full at once, in cash. */
  paidNow?: boolean;
  /** Save as a draft: no number yet, not in the books until issued. */
  draft?: boolean;
  /** Several items: every item, item 1 first (the same as rate/hsn/quantity/uqc
   *  above). The draft's `amount` is then their sum. */
  lines?: GstLineInput[];
}

export interface GstLineInput {
  amount: string;
  rate: string;
  hsn: string;
  quantity: string;
  uqc: string;
}

export type GstStatus = 'draft' | 'issued' | 'cancelled';

/** Whether an entry counts in the balance (drafts and cancelled invoices don't). */
export const countsInBooks = (e: Pick<LedgerEntry, 'gstStatus'>): boolean =>
  e.gstStatus !== 'draft' && e.gstStatus !== 'cancelled';

/** Chronological signed delta of an entry on the outstanding balance. */
function signedAmount(entry: LedgerEntry): number {
  if (!countsInBooks(entry)) return 0;
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
