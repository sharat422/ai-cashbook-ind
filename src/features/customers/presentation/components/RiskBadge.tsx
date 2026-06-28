import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import type {RiskCategory} from '@features/customers/domain/risk';
import {RISK_STYLE} from './riskStyle';

/** Color-coded Low / Medium / High risk pill. Reusable. */
export function RiskBadge({
  category,
}: {
  category: RiskCategory;
}): React.JSX.Element {
  const s = RISK_STYLE[category];
  return (
    <View className={`flex-row items-center rounded-full px-2.5 py-1 ${s.chipBg}`}>
      <View
        className="mr-1.5 h-1.5 w-1.5 rounded-full"
        style={{backgroundColor: s.color}}
      />
      <Text className={`text-[11px] font-semibold ${s.chipText}`}>
        {s.label}
      </Text>
    </View>
  );
}
