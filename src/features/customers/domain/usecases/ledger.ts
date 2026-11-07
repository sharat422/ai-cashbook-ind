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
    const problem = gstInputError(draft.invoiceNumber, draft.gst);
    if (problem) throw new Error(problem.message);
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
      invoiceNumber: input.invoiceNumber?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      paymentMethod: input.paymentMethod,
      referenceNumber: input.referenceNumber?.trim() || undefined,
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
