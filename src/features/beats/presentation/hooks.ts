import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {beatsRemote, type Beat, type BeatDraft, type VisitInput} from '@features/beats/data/beats.remote';
import {saveVisit} from '@features/beats/data/visitQueue';
import {ledgerUseCases} from '@features/customers/di';
import type {LedgerEntryInput} from '@features/customers/domain/usecases/ledger';
import {warnIfDuplicateReference} from '@features/customers/presentation/hooks/useLedgerMutations';

export const BEATS_KEY = 'beats';

export function useBeats() {
  return useQuery<Beat[]>({queryKey: [BEATS_KEY, 'all'], queryFn: beatsRemote.list});
}

export function useDeletedBeats(enabled: boolean) {
  return useQuery<Beat[]>({queryKey: [BEATS_KEY, 'deleted'], queryFn: beatsRemote.listDeleted, enabled});
}

/** Today's beats, or just one beat when an id is given (owner opening a beat). */
export function useDayList(beatId?: string) {
  return useQuery<Beat[]>({
    queryKey: [BEATS_KEY, beatId ?? 'today'],
    queryFn: async () => (beatId ? [await beatsRemote.get(beatId)] : beatsRemote.today()),
  });
}

export function useBeatMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({queryKey: [BEATS_KEY]});
  const create = useMutation({
    mutationFn: (draft: BeatDraft) => beatsRemote.create(draft),
    onSuccess: invalidate,
  });
  const setRetailers = useMutation({
    mutationFn: ({beatId, customerIds}: {beatId: string; customerIds: string[]}) =>
      beatsRemote.setRetailers(beatId, customerIds),
    onSuccess: invalidate,
  });
  const edit = useMutation({
    mutationFn: ({beatId, draft}: {beatId: string; draft: Omit<BeatDraft, 'customerIds'>}) =>
      beatsRemote.edit(beatId, draft),
    onSuccess: invalidate,
  });
  const remove = useMutation({mutationFn: (beatId: string) => beatsRemote.remove(beatId), onSuccess: invalidate});
  const assign = useMutation({
    mutationFn: ({beatId, userId, validFrom, validTo}: {
      beatId: string; userId: string; validFrom?: string; validTo?: string | null;
    }) => beatsRemote.addHelper(beatId, userId, validFrom, validTo),
    onSuccess: invalidate,
  });
  const unassign = useMutation({
    mutationFn: ({beatId, userId}: {beatId: string; userId: string}) => beatsRemote.removeHelper(beatId, userId),
    onSuccess: invalidate,
  });
  const restore = useMutation({mutationFn: (beatId: string) => beatsRemote.restore(beatId), onSuccess: invalidate});
  return {create, setRetailers, edit, remove, assign, unassign, restore};
}

/** Resolves true when saved, false when queued offline. */
export function useRecordVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visit: VisitInput) => saveVisit(visit),
    onSuccess: () => qc.invalidateQueries({queryKey: [BEATS_KEY]}),
  });
}

/** A payment collected on the beat, tagged with it for the daily close. Offline
 *  it is queued by the ledger repository like any other payment. */
export function useCollectOnBeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({customerId, input}: {customerId: string; input: LedgerEntryInput}) =>
      ledgerUseCases.receivePayment(customerId, input),
    onSuccess: entry => {
      qc.invalidateQueries({queryKey: [BEATS_KEY]});
      warnIfDuplicateReference(entry);
    },
  });
}
