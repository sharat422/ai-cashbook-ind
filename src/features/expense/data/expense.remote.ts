import {apiRequest} from '@api/client';
import type {Expense, ExpenseDraft} from '@features/expense/domain/entities';
import {toExpense, type ExpenseDto} from './expense.dto';

/**
 * Remote data source — talks to the FastAPI backend.
 *
 * Endpoint contract:
 *   POST /api/v1/expenses   (multipart/form-data)
 *     fields: amount, category, date, vendor, notes?, client_id, attachment?
 *     200 -> ExpenseDto
 *   GET  /api/v1/expenses
 *     200 -> ExpenseDto[]
 */
export const expenseRemote = {
  async create(draft: ExpenseDraft, clientId: string): Promise<Expense> {
    const form = new FormData();
    form.append('amount', String(draft.amount));
    form.append('category', draft.category);
    form.append('date', draft.date);
    form.append('vendor', draft.vendor);
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

    const dto = await apiRequest<ExpenseDto>('/expenses', {
      method: 'POST',
      body: form,
    });
    return toExpense(dto);
  },

  async list(): Promise<Expense[]> {
    const dtos = await apiRequest<ExpenseDto[]>('/expenses', {method: 'GET'});
    return dtos.map(toExpense);
  },
};
