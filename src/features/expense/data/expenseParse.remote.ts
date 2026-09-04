import {apiRequest} from '@api/client';
import type {RecordedAudio} from '@features/ai-entry/data/voiceRecorder';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '@features/expense/domain/entities';

export type Confidence = 'high' | 'medium' | 'low';

/** Structured expense extracted from speech/text, with uncertainty flags so the
 * UI can ask the user to confirm before saving. */
export interface ParsedExpense {
  amount: number | null;
  category: ExpenseCategory | null;
  vendor: string | null;
  date: string;
  note: string;
  detectedLanguage: string;
  currency: string | null;
  confidence: Confidence;
  needsConfirmation: boolean;
  /** Server field names needing review: amount | currency | category | vendor | date */
  ambiguousFields: string[];
  transcript: string;
}

interface ParsedExpenseDto {
  amount: number | null;
  category: string | null;
  vendor: string | null;
  date: string;
  note: string;
  detected_language: string;
  currency: string | null;
  confidence: string;
  needs_confirmation: boolean;
  ambiguous_fields: string[];
  raw_transcript: string;
}

function toConfidence(v: string): Confidence {
  return v === 'high' || v === 'medium' ? v : 'low';
}

function toParsed(dto: ParsedExpenseDto): ParsedExpense {
  // Only accept a category that's in the app's fixed set; else leave null.
  const category =
    dto.category &&
    (EXPENSE_CATEGORIES as readonly string[]).includes(dto.category)
      ? (dto.category as ExpenseCategory)
      : null;
  return {
    amount: dto.amount ?? null,
    category,
    vendor: dto.vendor ?? null,
    date: dto.date,
    note: dto.note ?? '',
    detectedLanguage: dto.detected_language ?? 'und',
    currency: dto.currency ?? null,
    confidence: toConfidence(dto.confidence),
    needsConfirmation: !!dto.needs_confirmation,
    ambiguousFields: Array.isArray(dto.ambiguous_fields)
      ? dto.ambiguous_fields
      : [],
    transcript: dto.raw_transcript ?? '',
  };
}

export const expenseParseRemote = {
  /** Parse typed text into an expense. */
  async parseText(
    text: string,
    today: string,
    language?: string,
  ): Promise<ParsedExpense> {
    const dto = await apiRequest<ParsedExpenseDto>('/parse-expense', {
      method: 'POST',
      body: {text, today, language},
    });
    return toParsed(dto);
  },

  /** Upload a recorded clip; the server transcribes then extracts the expense. */
  async voiceParse(
    audio: RecordedAudio,
    today: string,
    language?: string,
  ): Promise<ParsedExpense> {
    const form = new FormData();
    form.append('audio', {
      uri: audio.uri,
      name: audio.name,
      type: audio.type,
    } as unknown as Blob);
    form.append('today', today);
    if (language) form.append('language', language);

    const dto = await apiRequest<ParsedExpenseDto>('/voice/parse-expense', {
      method: 'POST',
      body: form,
      timeoutMs: 60_000,
    });
    return toParsed(dto);
  },
};
