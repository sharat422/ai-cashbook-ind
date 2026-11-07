import type {Expense, ExpenseDraft} from '../entities';
import type {ExpenseRepository} from '../repository';
import {validateExpenseDraft} from '../validation';
import {tNow} from '@/i18n';

/**
 * Use case: validate then persist an expense draft. Throws on validation
 * failure (with `.fields`) so the presentation layer can surface field errors;
 * otherwise delegates offline-first/optimistic handling to the repository.
 */
export function createExpenseUseCase(repo: ExpenseRepository) {
  return async (draft: ExpenseDraft): Promise<Expense> => {
    const errors = validateExpenseDraft(draft);
    if (Object.keys(errors).length > 0) {
      const err = new Error(tNow('errors.fixFields'));
      (err as Error & {fields?: unknown}).fields = errors;
      throw err;
    }
    return repo.create(draft);
  };
}
