import {useQuery} from '@tanstack/react-query';

import {ledgerUseCases} from '@features/customers/di';
import type {CustomerLedger} from '@features/customers/domain/ledger';

export const LEDGER_KEY = 'customer-ledger';

/** Fetch a customer's ledger (entries with running balances + totals). */
export function useCustomerLedger(customerId: string) {
  return useQuery<CustomerLedger, Error>({
    queryKey: [LEDGER_KEY, customerId],
    queryFn: () => ledgerUseCases.getLedger(customerId),
    staleTime: 30_000,
    retry: 1,
  });
}
