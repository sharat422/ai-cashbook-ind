import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {ApiError, NetworkError} from '@api/client';
import {customerRemote} from '@features/customers/data/customer.remote';

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
 *  Offline or not allowed (staff): kept for the next try. */
export async function uploadLocalCreditLimits(): Promise<boolean> {
  const {limits, clearLimit} = useCreditLimitStore.getState();
  let moved = false;
  for (const [customerId, amount] of Object.entries(limits)) {
    try {
      await customerRemote.setCreditLimit(customerId, amount);
      clearLimit(customerId);
      moved = true;
    } catch (err) {
      if (err instanceof NetworkError) break;
      if (err instanceof ApiError && err.status === 404) clearLimit(customerId); // customer gone
    }
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
