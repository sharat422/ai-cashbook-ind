import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import type {CustomerStatus} from '@features/customers/domain/entities';
import {STATUS_STYLE} from './statusStyle';

/** Pill showing the dues status with a colour dot. Reusable across the feature. */
function StatusBadgeBase({
  status,
}: {
  status: CustomerStatus;
}): React.JSX.Element {
  const s = STATUS_STYLE[status];
  return (
    <View
      className={`flex-row items-center rounded-full px-2.5 py-1 ${s.chipBg}`}>
      <View className={`mr-1.5 h-1.5 w-1.5 rounded-full ${s.dot}`} />
      <Text className={`text-[11px] font-semibold ${s.chipText}`}>
        {s.label}
      </Text>
    </View>
  );
}

export const StatusBadge = React.memo(StatusBadgeBase);
