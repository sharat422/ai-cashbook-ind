import {useMutation} from '@tanstack/react-query';

import {expenseUseCases} from '@features/expense/di';
import type {Expense, ExpenseDraft} from '@features/expense/domain/entities';

/**
 * Wraps the create-expense use case in a React Query mutation. The use case
 * inserts an optimistic entry immediately; on success we kick off a background
 * sync so an online entry is confirmed almost instantly, while an offline one
 * stays queued for the sync manager to flush later.
 */
export function useCreateExpense() {
  return useMutation<Expense, Error, ExpenseDraft>({
    mutationFn: draft => expenseUseCases.create(draft),
    onSuccess: () => {
      // Fire-and-forget — never block the UI on the network.
      void expenseUseCases.syncPending();
    },
  });
}
