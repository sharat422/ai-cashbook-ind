import {apiRequest} from '@api/client';

/**
 * Ask AI (read-only chatbot). POST /chatbot/ask: the server scopes every answer
 * to the logged-in merchant and replaces anything it can't verify.
 */

export interface CustomerChoice {
  customerId: string;
  name: string;
  businessName: string | null;
  mobileMasked: string | null;
}

/** Date range the answer covers, from the tool results (not the model). */
export type AnswerPeriod = {from: string; to: string} | {asOf: string};

/** Where "View details" goes: a customer's profile or an app screen. */
export type ViewDetails =
  | {screen: 'CustomerProfile'; customerId: string}
  | {screen: 'TransactionHistory' | 'KhataDashboard'};

export interface ChatbotAnswer {
  /** Id of this question/answer, for feedback. */
  questionId: string;
  answer: string;
  /** Set when the request was refused (delete_data, transfer_money, other_merchant). */
  blocked: string | null;
  period: AnswerPeriod | null;
  viewDetails: ViewDetails | null;
  /** false when the server replaced an unverifiable model answer. */
  verified: boolean;
  /** 'database' | 'help_docs' | 'database+help_docs' | 'none' */
  dataSource: string;
  /** Set when a name matched several customers: show these to pick from. */
  candidates: CustomerChoice[];
  /** Help-guide files the answer came from. */
  sources: string[];
  /** App screen the answer offers to open (help answers). */
  suggestedScreen: {screen: string; label: string} | null;
}

/** Languages Ask AI answers in (fixed replies are translated for these). */
export type ChatLanguage = 'hinglish' | 'hi' | 'en' | 'te' | 'ta' | 'ml';

export interface AskInput {
  text: string;
  inputMode: 'voice' | 'text';
  selectedCustomerId?: string;
  languageHint?: ChatLanguage;
}

interface ChatbotAnswerDto {
  question_id: string;
  answer_text: string;
  blocked?: string | null;
  period?: {from?: string; to?: string; as_of?: string} | null;
  view_details?: {screen: string; customer_id?: string} | null;
  verified: boolean;
  data_source: string;
  candidates?: Array<{
    customer_id: string;
    name: string;
    business_name: string | null;
    mobile_masked: string | null;
  }>;
  sources?: string[];
  suggested_screen?: {screen: string; label: string} | null;
}

function toPeriod(p: ChatbotAnswerDto['period']): AnswerPeriod | null {
  if (p?.from && p.to) return {from: p.from, to: p.to};
  if (p?.as_of) return {asOf: p.as_of};
  return null;
}

function toViewDetails(v: ChatbotAnswerDto['view_details']): ViewDetails | null {
  if (v?.screen === 'CustomerProfile' && v.customer_id) {
    return {screen: 'CustomerProfile', customerId: v.customer_id};
  }
  if (v?.screen === 'TransactionHistory' || v?.screen === 'KhataDashboard') {
    return {screen: v.screen};
  }
  return null; // anything unexpected: no link rather than a broken one
}

export function toChatbotAnswer(dto: ChatbotAnswerDto): ChatbotAnswer {
  return {
    questionId: dto.question_id,
    answer: dto.answer_text,
    blocked: dto.blocked ?? null,
    period: toPeriod(dto.period),
    viewDetails: toViewDetails(dto.view_details),
    verified: dto.verified,
    dataSource: dto.data_source,
    candidates: (dto.candidates ?? []).map(c => ({
      customerId: c.customer_id,
      name: c.name,
      businessName: c.business_name,
      mobileMasked: c.mobile_masked,
    })),
    sources: dto.sources ?? [],
    suggestedScreen: dto.suggested_screen ?? null,
  };
}

export const assistantRemote = {
  async ask(input: AskInput): Promise<ChatbotAnswer> {
    const dto = await apiRequest<ChatbotAnswerDto>('/chatbot/ask', {
      method: 'POST',
      body: {
        transcript_text: input.text,
        input_mode: input.inputMode,
        ...(input.languageHint ? {language_hint: input.languageHint} : {}),
        ...(input.selectedCustomerId
          ? {selected_customer_id: input.selectedCustomerId}
          : {}),
      },
    });
    return toChatbotAnswer(dto);
  },

  /** Thumbs up/down on one answer, with an optional note. */
  async feedback(questionId: string, rating: 'up' | 'down', note?: string): Promise<void> {
    await apiRequest<{ok: boolean}>('/chatbot/feedback', {
      method: 'POST',
      body: {question_id: questionId, rating, ...(note?.trim() ? {note: note.trim()} : {})},
    });
  },

  /** One-tap "Delete voice history" (removes stored Ask AI question/answer text). */
  async deleteHistory(): Promise<number> {
    const res = await apiRequest<{deleted: number}>('/chatbot/history', {
      method: 'DELETE',
    });
    return res.deleted;
  },
};
