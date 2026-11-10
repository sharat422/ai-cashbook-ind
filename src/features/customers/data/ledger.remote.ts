import {apiRequest} from '@api/client';
import type {
  LedgerEntry,
  LedgerEntryDraft,
} from '@features/customers/domain/ledger';
import {toLedgerEntry, type LedgerEntryDto} from './ledger.dto';

/**
 * Remote data source for the customer ledger.
 *
 *   GET  /api/v1/customers/{id}/ledger          -> LedgerEntryDto[]
 *   POST /api/v1/customers/{id}/ledger          (multipart/form-data) -> LedgerEntryDto
 *     fields: type, amount, date, client_id, invoice_number?, notes?, attachment?
 */
export const ledgerRemote = {
  async list(customerId: string): Promise<LedgerEntry[]> {
    const dtos = await apiRequest<LedgerEntryDto[]>(
      `/customers/${customerId}/ledger`,
      {method: 'GET'},
    );
    return (dtos ?? []).map(toLedgerEntry);
  },

  async add(
    customerId: string,
    draft: LedgerEntryDraft,
    clientId: string,
  ): Promise<LedgerEntry> {
    const form = new FormData();
    form.append('type', draft.type);
    form.append('amount', String(draft.amount));
    form.append('date', draft.date);
    form.append('client_id', clientId); // idempotency key for retries
    form.append('utr_rule', 'true'); // this app requires a UTR on UPI payments
    if (draft.invoiceNumber) form.append('invoice_number', draft.invoiceNumber);
    if (draft.notes) form.append('notes', draft.notes);
    if (draft.paymentMethod) form.append('payment_method', draft.paymentMethod);
    if (draft.referenceNumber) {
      form.append('reference_number', draft.referenceNumber);
    }
    if (draft.chequeBank) form.append('cheque_bank', draft.chequeBank);
    if (draft.chequeAccount) form.append('cheque_account', draft.chequeAccount);
    if (draft.beatId) form.append('beat_id', draft.beatId);
    if (draft.gst) {
      form.append('gst_rate', draft.gst.rate);
      form.append('hsn_code', draft.gst.hsn);
      form.append('quantity', draft.gst.quantity);
      form.append('uqc', draft.gst.uqc);
      form.append('price_includes_gst', String(draft.gst.priceIncludesGst));
      if (draft.gst.customerGstin) form.append('customer_gstin', draft.gst.customerGstin);
      if (draft.gst.placeOfSupply) form.append('place_of_supply', draft.gst.placeOfSupply);
    }
    if (draft.attachment) {
      form.append('attachment', {
        uri: draft.attachment.uri,
        name: draft.attachment.fileName,
        type: draft.attachment.type,
      } as unknown as Blob);
    }

    const dto = await apiRequest<LedgerEntryDto>(
      `/customers/${customerId}/ledger`,
      {method: 'POST', body: form},
    );
    return toLedgerEntry(dto);
  },
};
