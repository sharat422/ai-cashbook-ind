import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {
  reconciliationRemote,
  type DailyClose,
  type Exceptions,
  type StatementFile,
  type Suggestion,
} from '@features/reconciliation/data/reconciliation.remote';

export const RECON_KEY = 'reconciliation';

export function useSuggestions() {
  return useQuery<Suggestion[]>({queryKey: [RECON_KEY, 'suggestions'], queryFn: reconciliationRemote.suggestions});
}

export function useExceptions() {
  return useQuery<Exceptions>({queryKey: [RECON_KEY, 'exceptions'], queryFn: reconciliationRemote.exceptions});
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
  const importFile = useMutation({
    mutationFn: (file: StatementFile) => reconciliationRemote.importStatement(file),
    onSuccess: invalidate,
  });
  const confirm = useMutation({
    mutationFn: ({bankLineId, entryId}: {bankLineId: string; entryId: string}) =>
      reconciliationRemote.confirm(bankLineId, entryId),
    onSuccess: invalidate,
  });
  return {importFile, confirm};
}
