import React from 'react';
import {Pressable, View} from 'react-native';

import {Avatar, Text} from '@components/ui';
import {
  customerStatus,
  type Customer,
} from '@features/customers/domain/entities';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';
import {StatusBadge} from './StatusBadge';
import {STATUS_STYLE} from './statusStyle';

/** Fixed item height (card + gap) — lets the FlatList use getItemLayout. */
export const CARD_HEIGHT = 104;
const GAP = 12;

/** Soft premium shadow (CRED / GPay style) — subtle, not heavy. */
const SHADOW = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: {width: 0, height: 4},
  elevation: 2,
} as const;

function CustomerCardBase({
  customer,
  onPress,
}: {
  customer: Customer;
  onPress: () => void;
}): React.JSX.Element {
  const status = customerStatus(customer);
  const style = STATUS_STYLE[status];
  const subtitle = customer.businessName || `+91 ${customer.mobile}`;

  return (
    <View style={{height: CARD_HEIGHT, paddingBottom: GAP}}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className="flex-1 flex-row items-center rounded-2xl border border-border bg-white px-4"
        style={SHADOW}>
        <Avatar name={customer.fullName} size={48} />

        <View className="ml-3 flex-1 pr-2">
          <Text className="text-base font-semibold text-slate-900" numberOfLines={1}>
            {customer.fullName}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
          <Text className="mt-0.5 text-[11px] text-muted" numberOfLines={1}>
            {customer.lastTransactionDate
              ? `Last txn ${formatDisplayDate(customer.lastTransactionDate)}`
              : 'No transactions yet'}
          </Text>
        </View>

        <View className="items-end">
          <Text className={`text-base font-bold ${style.amount}`}>
            {customer.outstandingAmount > 0
              ? formatINR(customer.outstandingAmount)
              : '₹0'}
          </Text>
          <View className="mt-1.5">
            <StatusBadge status={status} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

/** Memoized — only re-renders when its customer reference changes. */
export const CustomerCard = React.memo(
  CustomerCardBase,
  (prev, next) => prev.customer === next.customer,
);
