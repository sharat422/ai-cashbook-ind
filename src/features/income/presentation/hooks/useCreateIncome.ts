import {useMutation} from '@tanstack/react-query';

import {incomeUseCases} from '@features/income/di';
import type {Income, IncomeDraft} from '@features/income/domain/entities';

/**
 * Wraps the create-income use case in a React Query mutation. The use case
 * handles validation + online/offline persistence; this hook just exposes
 * pending/error state to the screen.
 */
export function useCreateIncome() {
  return useMutation<Income, Error, IncomeDraft>({
    mutationFn: draft => incomeUseCases.create(draft),
  });
}
