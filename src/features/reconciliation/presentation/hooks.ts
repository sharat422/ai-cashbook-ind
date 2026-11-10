import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {
  reconciliationRemote,
  type DailyClose,
  type Exceptions,
  type MatchedLine,
  type StatementImport,
  type Suggestion,
} from '@features/reconciliation/data/reconciliation.remote';

export const RECON_KEY = 'reconciliation';

export function useSuggestions() {
  return useQuery<Suggestion[]>({queryKey: [RECON_KEY, 'suggestions'], queryFn: reconciliationRemote.suggestions});
}

export function useExceptions() {
  return useQuery<Exceptions>({queryKey: [RECON_KEY, 'exceptions'], queryFn: reconciliationRemote.exceptions});
}

export function useMatched() {
  return useQuery<MatchedLine[]>({queryKey: [RECON_KEY, 'matched'], queryFn: reconciliationRemote.matched});
}

export function useStatementImports() {
  return useQuery<StatementImport[]>({queryKey: [RECON_KEY, 'imports'], queryFn: reconciliationRemote.imports});
}

export function useDeletedStatements(enabled: boolean) {
  return useQuery<StatementImport[]>({
    queryKey: [RECON_KEY, 'imports', 'deleted'], queryFn: reconciliationRemote.deletedImports, enabled,
  });
}

export function useDailyClose(date: string, beatId?: string, enabled = true) {
  return useQuery<DailyClose>({
    queryKey: [RECON_KEY, 'close', date, beatId ?? 'all'],
    queryFn: () => reconciliationRemote.dailyClose(date, beatId),
    enabled,
  });
}

export function useReconMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({queryKey: [RECON_KEY]});
  const confirm = useMutation({
    mutationFn: ({bankLineId, entryId}: {bankLineId: string; entryId: string}) =>
      reconciliationRemote.confirm(bankLineId, entryId),
    onSuccess: invalidate,
  });
  const match = useMutation({
    mutationFn: ({bankLineId, entryIds}: {bankLineId: string; entryIds: string[]}) =>
      reconciliationRemote.match(bankLineId, entryIds),
    onSuccess: invalidate,
  });
  const split = useMutation({
    mutationFn: ({bankLineIds, entryId}: {bankLineIds: string[]; entryId: string}) =>
      reconciliationRemote.split(bankLineIds, entryId),
    onSuccess: invalidate,
  });
  const matchMany = useMutation({
    mutationFn: ({bankLineIds, entryIds}: {bankLineIds: string[]; entryIds: string[]}) =>
      reconciliationRemote.matchMany(bankLineIds, entryIds),
    onSuccess: invalidate,
  });
  const matchDeposit = useMutation({
    mutationFn: ({depositId, bankLineId}: {depositId: string; bankLineId: string}) =>
      reconciliationRemote.matchDeposit(depositId, bankLineId),
    onSuccess: invalidate,
  });
  const undo = useMutation({mutationFn: reconciliationRemote.undo, onSuccess: invalidate});
  const deleteImport = useMutation({mutationFn: reconciliationRemote.deleteImport, onSuccess: invalidate});
  const restoreImport = useMutation({mutationFn: reconciliationRemote.restoreImport, onSuccess: invalidate});
  const addUtr = useMutation({
    mutationFn: ({customerId, entryId, utr}: {customerId: string; entryId: string; utr: string}) =>
      reconciliationRemote.addUtr(customerId, entryId, utr),
    onSuccess: invalidate,
  });
  return {confirm, match, split, matchMany, matchDeposit, undo, deleteImport, restoreImport, addUtr};
}
