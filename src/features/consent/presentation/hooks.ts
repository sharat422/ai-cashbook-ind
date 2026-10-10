import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {consentRemote} from '@features/consent/data/consent.remote';
import {
  hasAiConsent,
  type ConsentChoice,
  type ConsentSnapshot,
} from '@features/consent/domain/entities';

const CONSENTS_KEY = ['consents'] as const;

/** The user's current per-purpose consent snapshot. */
export function useConsents() {
  return useQuery<ConsentSnapshot>({
    queryKey: CONSENTS_KEY,
    queryFn: consentRemote.get,
  });
}

/** Set one or more purposes; refreshes the cached snapshot on success. */
export function useUpdateConsents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (choices: ConsentChoice[]) => consentRemote.update(choices),
    onSuccess: (snapshot: ConsentSnapshot) =>
      qc.setQueryData(CONSENTS_KEY, snapshot),
  });
}

/** Convenience: has the user granted AI processing consent? */
export function useAiConsent(): boolean {
  const {data} = useConsents();
  return hasAiConsent(data);
}
