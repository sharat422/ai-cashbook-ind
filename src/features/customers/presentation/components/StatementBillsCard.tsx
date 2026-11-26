import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import type {Bill} from '@features/customers/domain/bills';
import {billLabel, useCustomerBills} from '@features/customers/presentation/hooks/useCustomerBills';
import {useT, type TKey} from '@/i18n';
import {formatINR} from '@utils/currency';

const STATUS: Record<Bill['status'], {key: TKey; tone: string}> = {
  paid: {key: 'statement.billPaid', tone: 'bg-green-50 text-success'},
  part: {key: 'statement.billPart', tone: 'bg-amber-50 text-amber-700'},
  open: {key: 'statement.billOpen', tone: 'bg-red-50 text-red-700'},
};

/**
 * Bill by bill: amount, paid against it, left, and Paid only when nothing is
 * left. Shows every bill still open and every bill dated in the statement's
 * range; the open bills add up to the balance. Nothing offline (the server
 * works out what each bill was paid).
 */
export function StatementBillsCard({customerId, from, to}: {
  customerId: string;
  from: string;
  to: string;
}): React.JSX.Element | null {
  const t = useT();
  const {data} = useCustomerBills(customerId);
  if (!data) return null;
  const shown = data.bills.filter((b: Bill) => b.left > 0 || (b.date >= from && b.date <= to));
  return (
    <View testID="statement-bills" className="mt-6 rounded-2xl border border-border bg-white p-4">
      <Text variant="label">{t('statement.billsTitle')}</Text>
      <Text variant="caption" className="mt-1">{t('statement.billsHint')}</Text>
      {shown.length === 0 ? (
        <Text variant="caption" className="mt-3">{t('statement.billsNone')}</Text>
      ) : (
        shown.map((b: Bill) => (
          <View key={b.id} testID={`statement-bill-${b.id}`} className="mt-3 border-t border-border pt-3">
            <View className="flex-row items-center justify-between" style={{gap: 8}}>
              <Text className="flex-1 text-sm font-semibold text-slate-900">{billLabel(t, b)}</Text>
              <Text className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[b.status].tone}`}>
                {t(STATUS[b.status].key)}
              </Text>
            </View>
            <Text variant="caption" className="mt-1">
              {t('statement.billFigures', {
                amount: formatINR(b.amount), paid: formatINR(b.paid), left: formatINR(b.left),
              })}
            </Text>
          </View>
        ))
      )}
      <Text testID="statement-bills-left" className="mt-3 text-sm font-bold text-slate-900">
        {t('statement.billsLeft', {amount: formatINR(data.left)})}
      </Text>
      {data.advance > 0 ? (
        <Text variant="caption" className="mt-1">
          {t('statement.billsAdvance', {amount: formatINR(data.advance)})}
        </Text>
      ) : null}
    </View>
  );
}
