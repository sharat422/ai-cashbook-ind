import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {itemRemote} from '@features/items/data/item.remote';
import type {ItemDraft} from '@features/items/domain/entities';

/** Fetch the catalog (optionally filtered by a search term). */
export function useItems(search: string) {
  return useQuery({
    queryKey: ['items', search],
    queryFn: () => itemRemote.list(search),
  });
}

/** Create / update / delete mutations that refresh the catalog on success. */
export function useItemMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({queryKey: ['items']});

  const create = useMutation({
    mutationFn: (draft: ItemDraft) => itemRemote.create(draft),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({id, draft}: {id: string; draft: ItemDraft}) =>
      itemRemote.update(id, draft),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => itemRemote.remove(id),
    onSuccess: invalidate,
  });

  return {create, update, remove};
}
