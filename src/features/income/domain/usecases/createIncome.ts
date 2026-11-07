import type {Income, IncomeDraft} from '../entities';
import type {IncomeRepository} from '../repository';
import {validateIncomeDraft} from '../validation';
import {tNow} from '@/i18n';

/**
 * Use case: validate then persist an income draft. Throws on validation
 * failure so the presentation layer can surface field errors; otherwise
 * delegates online/offline handling to the repository.
 */
export function createIncomeUseCase(repo: IncomeRepository) {
  return async (draft: IncomeDraft): Promise<Income> => {
    const errors = validateIncomeDraft(draft);
    if (Object.keys(errors).length > 0) {
      const err = new Error(tNow('errors.fixFields'));
      (err as Error & {fields?: unknown}).fields = errors;
      throw err;
    }
    return repo.create(draft);
  };
}
