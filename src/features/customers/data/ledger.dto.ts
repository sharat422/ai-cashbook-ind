import type {
  LedgerEntry,
  LedgerEntryType,
  PaymentMethod,
} from '@features/customers/domain/ledger';

/** Backend ledger entry (snake_case). */
export interface LedgerEntryDto {
  id: string;
  type: LedgerEntryType;
  amount: number;
  date: string;
  invoice_number: string | null;
  notes: string | null;
  payment_method: PaymentMethod | null;
  reference_number: string | null;
  attachment_url: string | null;
  created_at: string;
}

export function toLedgerEntry(dto: LedgerEntryDto): LedgerEntry {
  return {
    id: dto.id,
    type: dto.type,
    amount: Number(dto.amount ?? 0),
    date: dto.date,
    invoiceNumber: dto.invoice_number ?? undefined,
    notes: dto.notes ?? undefined,
    paymentMethod: dto.payment_method ?? undefined,
    referenceNumber: dto.reference_number ?? undefined,
    attachmentUrl: dto.attachment_url ?? undefined,
    attachment: null,
    createdAt: dto.created_at,
    syncStatus: 'synced',
  };
}
