import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {recurringRemote} from '@features/recurring/data/recurring.remote';
import type {RecurringDraft} from '@features/recurring/domain/entities';

/** Fetch all recurring-expense templates + due/monthly totals. */
export function useRecurringExpenses() {
  return useQuery({
    queryKey: ['recurring-expenses'],
    queryFn: recurringRemote.list,
  });
}

/** Create / update / delete / post mutations that refresh the list on success. */
export function useRecurringMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({queryKey: ['recurring-expenses']});
    // Posting an occurrence creates an expense — refresh the dashboard too.
    qc.invalidateQueries({queryKey: ['dashboard-summary']});
    qc.invalidateQueries({queryKey: ['business-summary']});
  };

  const create = useMutation({
    mutationFn: (draft: RecurringDraft) => recurringRemote.create(draft),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({id, draft}: {id: string; draft: RecurringDraft}) =>
      recurringRemote.update(id, draft),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => recurringRemote.remove(id),
    onSuccess: invalidate,
  });
  const post = useMutation({
    mutationFn: (id: string) => recurringRemote.post(id),
    onSuccess: invalidate,
  });

  return {create, update, remove, post};
}
