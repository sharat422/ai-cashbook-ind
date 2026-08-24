import {apiRequest} from '@api/client';

export interface AssistantAnswer {
  intent: string;
  answer: string;
  // Optional structured payload (items, amount, monthly breakdown…).
  [key: string]: unknown;
}

export const assistantRemote = {
  async ask(question: string): Promise<AssistantAnswer> {
    return apiRequest<AssistantAnswer>('/assistant/ask', {
      method: 'POST',
      body: {question},
    });
  },
};
