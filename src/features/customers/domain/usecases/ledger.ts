import type {Attachment} from '@/shared/types/attachment';
import {gstInputError} from '@features/gst/domain/gst';
import {isUtrMissing} from '../ledger';
import type {
  CustomerLedger,
  GstInvoiceInput,
  LedgerEntry,
  LedgerEntryDraft,
  PaymentMethod,
} from '../ledger';
import type {LedgerRepository} from '../ledgerRepository';
import {tNow} from '@/i18n';
import {todayIST} from '@utils/date';

/** Input shared by add-credit and receive-payment. */
export interface LedgerEntryInput {
  amount: number;
  date: string;
  invoiceNumber?: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  chequeBank?: string;
  chequeAccount?: string;
  attachment?: Attachment | null;
  beatId?: string;
  gst?: GstInvoiceInput;
}

function assertValid(draft: LedgerEntryDraft): void {
  if (Number.isNaN(draft.amount) || draft.amount <= 0) {
    throw new Error(tNow('errors.amountPositive'));
  }
  if (draft.amount > 10_000_000) {
    throw new Error(tNow('errors.amountTooLarge'));
  }
  if (!draft.date || draft.date.slice(0, 10) > todayIST()) {
    throw new Error(tNow('errors.dateFuture'));
  }
  if (draft.type === 'payment' && isUtrMissing(draft.paymentMethod, draft.referenceNumber)) {
    throw new Error(tNow('errors.utrRequired'));
  }
  if (draft.gst) {
    if (draft.type !== 'credit') throw new Error(tNow('errors.gstOnPayment'));
    const problem = gstInputError(draft.gst);
    if (problem) throw new Error(problem.message);
    for (const [i, line] of (draft.gst.lines ?? []).entries()) {
      const p = gstInputError({...line, customerGstin: draft.gst.customerGstin});
      if (p) throw new Error(tNow('gst.itemProblem', {n: i + 1, message: p.message}));
      if (!(Number(line.amount) > 0)) throw new Error(tNow('gst.itemProblem', {n: i + 1, message: tNow('errors.amountPositive')}));
    }
  }
}

/** Ledger use cases bound to a repository. */
export function makeLedgerUseCases(repo: LedgerRepository) {
  const add = (
    customerId: string,
    type: LedgerEntryDraft['type'],
    input: LedgerEntryInput,
  ): Promise<LedgerEntry> => {
    const draft: LedgerEntryDraft = {
      type,
      amount: input.amount,
      date: input.date,
      // A GST invoice's number is assigned by the server; never send our own.
      invoiceNumber: input.gst ? undefined : input.invoiceNumber?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      paymentMethod: input.paymentMethod,
      referenceNumber: input.referenceNumber?.trim() || undefined,
      chequeBank: input.paymentMethod === 'cheque' ? input.chequeBank?.trim() || undefined : undefined,
      chequeAccount: input.paymentMethod === 'cheque' ? input.chequeAccount?.trim() || undefined : undefined,
      attachment: input.attachment ?? null,
      beatId: input.beatId,
      gst: input.gst,
    };
    assertValid(draft);
    return repo.addEntry(customerId, draft);
  };

  return {
    getLedger: (customerId: string): Promise<CustomerLedger> =>
      repo.getLedger(customerId),
    addCredit: (customerId: string, input: LedgerEntryInput) =>
      add(customerId, 'credit', input),
    receivePayment: (customerId: string, input: LedgerEntryInput) =>
      add(customerId, 'payment', input),
  };
}
