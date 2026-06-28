import {apiRequest} from '@api/client';
import type {Income, IncomeDraft} from '@features/income/domain/entities';
import {toIncome, type IncomeDto} from './income.dto';

/**
 * Remote data source — talks to the FastAPI backend.
 *
 * Endpoint contract:
 *   POST /api/v1/incomes   (multipart/form-data)
 *     fields: amount, category, date, notes?, client_id, attachment? (file)
 *     200 -> IncomeDto
 *   GET  /api/v1/incomes
 *     200 -> IncomeDto[]
 */
export const incomeRemote = {
  async create(draft: IncomeDraft, clientId: string): Promise<Income> {
    const form = new FormData();
    form.append('amount', String(draft.amount));
    form.append('category', draft.category);
    form.append('date', draft.date);
    form.append('client_id', clientId); // idempotency key for retries
    if (draft.notes) form.append('notes', draft.notes);
    if (draft.attachment) {
      // React Native's FormData accepts {uri, name, type} for file parts.
      form.append('attachment', {
        uri: draft.attachment.uri,
        name: draft.attachment.fileName,
        type: draft.attachment.type,
      } as unknown as Blob);
    }

    const dto = await apiRequest<IncomeDto>('/incomes', {
      method: 'POST',
      body: form,
    });
    return toIncome(dto);
  },

  async list(): Promise<Income[]> {
    const dtos = await apiRequest<IncomeDto[]>('/incomes', {method: 'GET'});
    return dtos.map(toIncome);
  },
};
