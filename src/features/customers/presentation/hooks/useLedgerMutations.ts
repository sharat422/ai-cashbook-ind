import {useMutation, useQueryClient} from '@tanstack/react-query';

import {ledgerUseCases} from '@features/customers/di';
import type {LedgerEntry} from '@features/customers/domain/ledger';
import type {LedgerEntryInput} from '@features/customers/domain/usecases/ledger';
import {CUSTOMERS_KEY} from './useCustomers';
import {LEDGER_KEY} from './useCustomerLedger';

type EntryInput = LedgerEntryInput;

/**
 * Add-credit / receive-payment mutations for a customer. On success both the
 * ledger and the customer list (outstanding amount) are invalidated.
 */
export function useLedgerMutations(customerId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({queryKey: [LEDGER_KEY, customerId]});
    queryClient.invalidateQueries({queryKey: [CUSTOMERS_KEY]});
  };

  const addCredit = useMutation<LedgerEntry, Error, EntryInput>({
    mutationFn: input => ledgerUseCases.addCredit(customerId, input),
    onSuccess: invalidate,
  });

  const receivePayment = useMutation<LedgerEntry, Error, EntryInput>({
    mutationFn: input => ledgerUseCases.receivePayment(customerId, input),
    onSuccess: invalidate,
  });

  return {addCredit, receivePayment};
}
