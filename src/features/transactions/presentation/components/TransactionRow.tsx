import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import type {Transaction} from '@features/transactions/domain/entities';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

/**
 * Fixed item height (card + gap). Exported so the FlatList can supply
 * `getItemLayout`, which lets it skip measuring every row — essential for
 * smooth scrolling over very large lists.
 */
export const ROW_HEIGHT = 76;
const GAP = 8;

function TransactionRowBase({tx}: {tx: Transaction}): React.JSX.Element {
  const isIncome = tx.type === 'income';
  const title = tx.vendor ? `${tx.category} · ${tx.vendor}` : tx.category;

  return (
    <View style={{height: ROW_HEIGHT, paddingBottom: GAP}}>
      <View className="flex-1 flex-row items-center rounded-xl border border-border bg-white px-4">
        <View
          className={`mr-3 h-10 w-10 items-center justify-center rounded-full ${
            isIncome ? 'bg-green-50' : 'bg-red-50'
          }`}>
          <Text className="text-base">{isIncome ? '💰' : '🧾'}</Text>
        </View>

        <View className="flex-1 pr-3">
          <Text className="font-semibold text-slate-900" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {formatDisplayDate(tx.date)}
          </Text>
        </View>

        <Text
          className={`font-bold ${isIncome ? 'text-success' : 'text-danger'}`}
          numberOfLines={1}>
          {isIncome ? '+' : '−'}
          {formatINR(tx.amount)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Memoized so the FlatList only re-renders rows whose transaction actually
 * changed (cheap equality on the immutable `tx` reference).
 */
export const TransactionRow = React.memo(
  TransactionRowBase,
  (prev, next) => prev.tx === next.tx,
);
