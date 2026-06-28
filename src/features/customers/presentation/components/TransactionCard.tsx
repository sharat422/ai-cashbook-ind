import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {
  PAYMENT_METHOD_LABEL,
  type LedgerEntryView,
} from '@features/customers/domain/ledger';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

/**
 * Reusable ledger transaction card: type, date, notes, signed amount, and the
 * running balance after the transaction. Credit (owed) is amber, payment
 * (received) is green.
 */
function TransactionCardBase({
  entry,
}: {
  entry: LedgerEntryView;
}): React.JSX.Element {
  const isCredit = entry.type === 'credit';
  return (
    <View className="rounded-2xl border border-border bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center" style={{gap: 6}}>
            <View
              className={`rounded-full px-2 py-0.5 ${
                isCredit ? 'bg-amber-50' : 'bg-green-50'
              }`}>
              <Text
                className={`text-[11px] font-semibold ${
                  isCredit ? 'text-amber-700' : 'text-success'
                }`}>
                {isCredit ? 'Credit given' : 'Payment received'}
              </Text>
            </View>
          </View>
          <Text variant="caption" className="mt-1">
            {formatDisplayDate(entry.date)}
            {!isCredit && entry.paymentMethod
              ? ` · via ${PAYMENT_METHOD_LABEL[entry.paymentMethod]}`
              : ''}
            {entry.syncStatus === 'pending' ? ' · pending sync' : ''}
          </Text>
          {entry.notes ? (
            <Text className="mt-1 text-sm text-slate-700" numberOfLines={2}>
              {entry.notes}
            </Text>
          ) : null}
        </View>

        <View className="items-end">
          <Text
            className={`text-base font-bold ${
              isCredit ? 'text-amber-700' : 'text-success'
            }`}>
            {isCredit ? '+' : '−'}
            {formatINR(entry.amount)}
          </Text>
          <Text className="mt-1 text-[11px] text-muted">
            Bal: {formatINR(entry.balance)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export const TransactionCard = React.memo(TransactionCardBase);
