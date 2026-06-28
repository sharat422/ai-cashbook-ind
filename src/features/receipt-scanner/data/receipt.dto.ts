import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '@features/expense/domain/entities';
import type {ReceiptExtraction} from '@features/receipt-scanner/domain/entities';

/** One {value, confidence} pair as returned by the backend. */
interface FieldDto<T> {
  value: T;
  confidence: number;
}

/** Backend response shape (snake_case). */
export interface ReceiptExtractionDto {
  vendor_name: FieldDto<string | null>;
  invoice_number: FieldDto<string | null>;
  gst_number: FieldDto<string | null>;
  amount: FieldDto<number | null>;
  tax_amount: FieldDto<number | null>;
  date: FieldDto<string | null>;
  category: FieldDto<string | null>;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Number(n) || 0));

const str = (dto: FieldDto<string | null>) => ({
  value: dto.value ?? '',
  confidence: clamp01(dto.confidence),
});

const num = (dto: FieldDto<number | null>) => ({
  value: dto.value == null ? NaN : Number(dto.value),
  confidence: clamp01(dto.confidence),
});

/** Coerce the model's category guess to a known category, else "Miscellaneous". */
function toCategory(dto: FieldDto<string | null>) {
  const match = EXPENSE_CATEGORIES.find(
    c => c.toLowerCase() === (dto.value ?? '').toLowerCase(),
  );
  return {
    value: (match ?? 'Miscellaneous') as ExpenseCategory,
    confidence: clamp01(dto.confidence),
  };
}

export function toReceiptExtraction(
  dto: ReceiptExtractionDto,
): ReceiptExtraction {
  return {
    vendorName: str(dto.vendor_name),
    invoiceNumber: str(dto.invoice_number),
    gstNumber: str(dto.gst_number),
    amount: num(dto.amount),
    taxAmount: num(dto.tax_amount),
    date: str(dto.date),
    category: toCategory(dto.category),
  };
}
