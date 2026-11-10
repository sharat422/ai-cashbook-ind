import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {ApiError, NetworkError} from '@api/client';
import {customerRemote} from '@features/customers/data/customer.remote';
import {tNow} from '@/i18n';
import {useInboxStore} from '@/services/notifications/inbox.store';

interface CreditLimitState {
  /** Limits saved on this phone before they moved to the server, by customer id. */
  limits: Record<string, number>;
  clearLimit: (customerId: string) => void;
}

/** Credit limits now live on the server (Customer.creditLimit). This store only
 *  holds limits set by older app versions until they are uploaded. */
export const useCreditLimitStore = create<CreditLimitState>()(
  persist(
    set => ({
      limits: {},
      clearLimit: customerId =>
        set(s => {
          const {[customerId]: _removed, ...rest} = s.limits;
          return {limits: rest};
        }),
    }),
    {
      name: 'credit-limits',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Upload phone-only limits once, then forget them. Returns true if any moved.
 *  Only where the server has never had a limit (expectedVersion 0): if
 *  another device set one, the server wins and a notice goes to the inbox —
 *  never a silent overwrite. Offline or not allowed (staff): kept for the next try. */
export async function uploadLocalCreditLimits(): Promise<boolean> {
  const {limits, clearLimit} = useCreditLimitStore.getState();
  let moved = false;
  let kept = 0;
  for (const [customerId, amount] of Object.entries(limits)) {
    try {
      await customerRemote.setCreditLimit(customerId, amount, 0);
      clearLimit(customerId);
      moved = true;
    } catch (err) {
      if (err instanceof NetworkError) break;
      if (err instanceof ApiError && err.status === 404) clearLimit(customerId); // customer gone
      if (err instanceof ApiError && err.status === 409) {
        clearLimit(customerId); // the server's newer limit stays
        kept += 1;
      }
    }
  }
  if (kept > 0) {
    useInboxStore.getState().add({
      title: tNow('customers.limitChangedTitle'),
      body: tNow('customers.oldLimitsSkipped', {count: kept}),
      data: {type: 'credit-limit-conflict'},
    });
  }
  return moved;
}

export type CreditLimitStatus = 'ok' | 'approaching' | 'exceeded';

/** Evaluate an outstanding balance against a limit. */
export function creditLimitStatus(
  outstanding: number,
  limit: number | undefined,
): {status: CreditLimitStatus; over: number} {
  if (!limit || limit <= 0) return {status: 'ok', over: 0};
  if (outstanding > limit) return {status: 'exceeded', over: outstanding - limit};
  if (outstanding >= limit * 0.95) return {status: 'approaching', over: 0};
  return {status: 'ok', over: 0};
}
