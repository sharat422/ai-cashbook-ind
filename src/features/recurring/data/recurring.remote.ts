import {apiRequest} from '@api/client';
import type {
  RecurringDraft,
  RecurringExpense,
  RecurringList,
} from '@features/recurring/domain/entities';
import {
  fromRecurringDraft,
  toRecurring,
  toRecurringList,
  type PostOccurrenceDto,
  type RecurringDto,
  type RecurringListDto,
} from './recurring.dto';

/**
 * Remote data source — FastAPI recurring-expense templates.
 *
 *   GET/POST /api/v1/recurring-expenses
 *   PATCH/DELETE /api/v1/recurring-expenses/{id}
 *   POST /api/v1/recurring-expenses/{id}/post  (record occurrence as expense)
 */
export const recurringRemote = {
  async list(): Promise<RecurringList> {
    const dto = await apiRequest<RecurringListDto>('/recurring-expenses', {
      method: 'GET',
    });
    return toRecurringList(dto);
  },

  async create(draft: RecurringDraft): Promise<RecurringExpense> {
    const dto = await apiRequest<RecurringDto>('/recurring-expenses', {
      method: 'POST',
      body: fromRecurringDraft(draft),
    });
    return toRecurring(dto);
  },

  async update(id: string, draft: RecurringDraft): Promise<RecurringExpense> {
    const dto = await apiRequest<RecurringDto>(`/recurring-expenses/${id}`, {
      method: 'PATCH',
      body: fromRecurringDraft(draft),
    });
    return toRecurring(dto);
  },

  async remove(id: string): Promise<void> {
    await apiRequest<null>(`/recurring-expenses/${id}`, {method: 'DELETE'});
  },

  async post(id: string): Promise<RecurringExpense> {
    const dto = await apiRequest<PostOccurrenceDto>(
      `/recurring-expenses/${id}/post`,
      {method: 'POST'},
    );
    return toRecurring(dto.recurring);
  },
};
