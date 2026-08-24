import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

interface CreditLimitState {
  /** Per-customer credit limit in INR, keyed by customer id. */
  limits: Record<string, number>;
  setLimit: (customerId: string, amount: number) => void;
  clearLimit: (customerId: string) => void;
}

export const useCreditLimitStore = create<CreditLimitState>()(
  persist(
    set => ({
      limits: {},
      setLimit: (customerId, amount) =>
        set(s => ({limits: {...s.limits, [customerId]: amount}})),
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

/** The credit limit for one customer, or undefined if none set. */
export const useCreditLimit = (customerId: string): number | undefined =>
  useCreditLimitStore(s => s.limits[customerId]);

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
