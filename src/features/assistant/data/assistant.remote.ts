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

export interface ChatbotAnswer {
  answer: string;
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

export interface AskInput {
  text: string;
  inputMode: 'voice' | 'text';
  selectedCustomerId?: string;
}

interface ChatbotAnswerDto {
  answer_text: string;
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

export function toChatbotAnswer(dto: ChatbotAnswerDto): ChatbotAnswer {
  return {
    answer: dto.answer_text,
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
        ...(input.selectedCustomerId
          ? {selected_customer_id: input.selectedCustomerId}
          : {}),
      },
    });
    return toChatbotAnswer(dto);
  },

  /** One-tap "Delete voice history" (removes stored Ask AI question/answer text). */
  async deleteHistory(): Promise<number> {
    const res = await apiRequest<{deleted: number}>('/chatbot/history', {
      method: 'DELETE',
    });
    return res.deleted;
  },
};
