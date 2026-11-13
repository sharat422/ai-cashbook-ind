import type {
  DuplicateReference,
  GstStatus,
  LedgerEntry,
  LedgerEntryType,
  PaymentMethod,
} from '@features/customers/domain/ledger';

/** Backend ledger entry (snake_case). */
export interface LedgerEntryDto {
  client_id?: string | null;
  id: string;
  type: LedgerEntryType;
  amount: number;
  date: string;
  invoice_number: string | null;
  gst_status?: GstStatus | null;
  notes: string | null;
  payment_method: PaymentMethod | null;
  reference_number: string | null;
  cheque_bank?: string | null;
  cheque_account?: string | null;
  /** Only on the save response: this bank/cheque reference repeats an earlier payment. */
  warning?: DuplicateReference;
  attachment_url: string | null;
  created_at: string;
}

export function toLedgerEntry(dto: LedgerEntryDto): LedgerEntry {
  return {
    id: dto.id,
    clientId: dto.client_id ?? undefined,
    type: dto.type,
    amount: Number(dto.amount ?? 0),
    date: dto.date,
    invoiceNumber: dto.invoice_number ?? undefined,
    gstStatus: dto.gst_status ?? undefined,
    notes: dto.notes ?? undefined,
    paymentMethod: dto.payment_method ?? undefined,
    referenceNumber: dto.reference_number ?? undefined,
    chequeBank: dto.cheque_bank ?? undefined,
    chequeAccount: dto.cheque_account ?? undefined,
    warning: dto.warning,
    attachmentUrl: dto.attachment_url ?? undefined,
    attachment: null,
    createdAt: dto.created_at,
    syncStatus: 'synced',
  };
}
