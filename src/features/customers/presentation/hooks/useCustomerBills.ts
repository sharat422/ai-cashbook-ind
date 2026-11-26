import {useQuery} from '@tanstack/react-query';

import {billsRemote} from '@features/customers/data/bills.remote';
import type {Bill, CustomerBills} from '@features/customers/domain/bills';
import {formatDisplayDate} from '@utils/date';
import type {TranslateFn} from '@/i18n';

export const BILLS_KEY = 'customer-bills';

/** The customer's bills and what is left on each (needs the server: none offline). */
export function useCustomerBills(customerId: string | undefined, beatId?: string, enabled = true) {
  return useQuery<CustomerBills>({
    queryKey: [BILLS_KEY, customerId, beatId ?? null],
    queryFn: () => billsRemote.list(customerId as string, beatId),
    enabled: Boolean(customerId) && enabled,
  });
}

/** "INV-12 · 3 Nov 2026", or "Sale of 3 Nov 2026" for a bill with no number. */
export function billLabel(t: TranslateFn, b: Pick<Bill, 'number' | 'date'>): string {
  const date = formatDisplayDate(b.date);
  return b.number ? `${b.number} · ${date}` : t('statement.saleOn', {date});
}
