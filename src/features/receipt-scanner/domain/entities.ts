/**
 * Domain entities for the AI Receipt Scanner. Pure types — no framework imports.
 */
import type {ExpenseCategory} from '@features/expense/domain/entities';
import type {Attachment} from '@/shared/types/attachment';

export type {Attachment};

/** Model confidence for a single extracted value, 0..1. */
export type Confidence = number;

/** One field the model extracted, paired with its confidence. */
export interface ExtractedField<T> {
  value: T;
  confidence: Confidence;
}

/** One purchased item row read off the receipt. Numbers are null when not printed. */
export interface ReceiptLineItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
}

/** A line item as the user edits it (every field is text in an input). */
export type EditableLineItem = Record<keyof ReceiptLineItem, string>;

export function toEditableLineItem(item: ReceiptLineItem): EditableLineItem {
  const s = (v: number | string | null) => (v == null ? '' : String(v));
  return {
    description: item.description,
    quantity: s(item.quantity),
    unit: s(item.unit),
    rate: s(item.rate),
    amount: s(item.amount),
  };
}

/** "Items:" block for the expense notes, e.g. "- Tea · 2 cup × 12.5 = 25". */
export function lineItemsNote(items: EditableLineItem[]): string {
  const lines = items
    .filter(i => i.description.trim())
    .map(i => {
      const qty = [i.quantity.trim(), i.unit.trim()].filter(Boolean).join(' ');
      let line = `- ${i.description.trim()}`;
      if (qty) line += ` · ${qty}`;
      if (i.rate.trim()) line += ` × ${i.rate.trim()}`;
      if (i.amount.trim()) line += ` = ${i.amount.trim()}`;
      return line;
    });
  return lines.length ? ['Items:', ...lines].join('\n') : '';
}

/**
 * The structured result of scanning a receipt: the six extracted fields plus
 * an AI-suggested expense category. Every field carries a confidence score so
 * the UI can flag low-confidence values for review.
 */
export interface ReceiptExtraction {
  receiptText: ExtractedField<string>;
  vendorName: ExtractedField<string>;
  invoiceNumber: ExtractedField<string>;
  gstNumber: ExtractedField<string>;
  /** Total amount in whole INR. */
  amount: ExtractedField<number>;
  /** Tax (GST) amount in whole INR. */
  taxAmount: ExtractedField<number>;
  /** ISO date (YYYY-MM-DD). */
  date: ExtractedField<string>;
  /** AI categorization into one of the expense categories. */
  category: ExtractedField<ExpenseCategory>;
  /** Item rows, in receipt order (empty when none were read). */
  lineItems: ReceiptLineItem[];
}

/** Stages surfaced to the user during a scan (drives the progress stepper). */
export type ScanStage =
  | 'idle'
  | 'uploading'
  | 'processing' // OCR
  | 'categorizing' // AI categorization
  | 'done'
  | 'error';

/** Confidence buckets for colour-coding + "needs review" prompts. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(confidence: Confidence): ConfidenceLevel {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

/** True when a field should be highlighted for the user to verify. */
export function needsReview(confidence: Confidence): boolean {
  return confidence < 0.6;
}
