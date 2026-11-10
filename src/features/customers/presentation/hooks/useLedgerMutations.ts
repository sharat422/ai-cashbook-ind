import {useMutation, useQueryClient} from '@tanstack/react-query';
import {Alert} from 'react-native';

import {ledgerUseCases} from '@features/customers/di';
import type {LedgerEntry} from '@features/customers/domain/ledger';
import type {LedgerEntryInput} from '@features/customers/domain/usecases/ledger';
import {tNow} from '@/i18n';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';
import {CUSTOMERS_KEY} from './useCustomers';
import {LEDGER_KEY} from './useCustomerLedger';

type EntryInput = LedgerEntryInput;

/** Saved, but its bank/cheque reference repeats an earlier payment: say so. */
export function warnIfDuplicateReference(entry: LedgerEntry): void {
  const w = entry.warning;
  if (!w) return;
  Alert.alert(tNow('payments.duplicateRefTitle'), tNow('payments.duplicateRefMsg', {
    amount: formatINR(Number(w.amount)), customer: w.customerName, date: formatDisplayDate(w.date),
  }));
}

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
    onSuccess: entry => {
      invalidate();
      warnIfDuplicateReference(entry);
    },
  });

  return {addCredit, receivePayment};
}
