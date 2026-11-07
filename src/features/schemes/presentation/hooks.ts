import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {
  schemesRemote,
  type BillInput,
  type Scheme,
  type SchemeApplication,
  type SchemeInput,
  type SchemeReport,
} from '@features/schemes/data/schemes.remote';
import {BEATS_KEY} from '@features/beats/presentation/hooks';
import {LEDGER_KEY} from '@features/customers/presentation/hooks/useCustomerLedger';
import {CUSTOMERS_KEY} from '@features/customers/presentation/hooks/useCustomers';
import {STOCK_KEY} from '@features/stock/presentation/hooks';

export const SCHEMES_KEY = 'schemes';

export const makeBillClientId = (): string =>
  `bill_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const useSchemes = () => useQuery<Scheme[]>({queryKey: [SCHEMES_KEY, 'list'], queryFn: schemesRemote.list});

export const useSchemeReport = (from: string, to: string) =>
  useQuery<SchemeReport>({queryKey: [SCHEMES_KEY, 'report', from, to], queryFn: () => schemesRemote.report(from, to)});

export const useSchemeLog = (from: string, to: string, customerId?: string) =>
  useQuery<SchemeApplication[]>({
    queryKey: [SCHEMES_KEY, 'log', from, to, customerId ?? 'all'],
    queryFn: () => schemesRemote.log(from, to, customerId),
  });

export function useSchemeMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({queryKey: [SCHEMES_KEY]});
  return {
    save: useMutation({
      mutationFn: ({id, input}: {id?: string; input: SchemeInput}) =>
        id ? schemesRemote.update(id, input) : schemesRemote.create(input),
      onSuccess,
    }),
    remove: useMutation({mutationFn: (id: string) => schemesRemote.remove(id), onSuccess}),
  };
}

export function useCreateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BillInput) => schemesRemote.createBill(input),
    onSuccess: () => {
      // A bill changes stock, the retailer's balance and the scheme log.
      for (const key of [SCHEMES_KEY, STOCK_KEY, CUSTOMERS_KEY, LEDGER_KEY, BEATS_KEY, 'items']) {
        qc.invalidateQueries({queryKey: [key]});
      }
    },
  });
}
