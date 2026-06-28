import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {formatINR} from '@utils/currency';

export interface HeroBalanceCardProps {
  balance: number;
  caption?: string;
}

/**
 * Prominent full-width cash-balance card. Negative balances render in a warm
 * tint to draw attention. Memoized to avoid re-rendering on unrelated updates.
 */
function HeroBalanceCardBase({
  balance,
  caption,
}: HeroBalanceCardProps): React.JSX.Element {
  const negative = balance < 0;
  return (
    <View className="rounded-3xl bg-slate-900 px-5 py-6">
      <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Cash Balance
      </Text>
      <Text
        className={`mt-2 text-4xl font-bold ${
          negative ? 'text-red-300' : 'text-white'
        }`}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {negative ? '−' : ''}
        {formatINR(Math.abs(balance))}
      </Text>
      {caption ? (
        <Text className="mt-2 text-xs text-slate-400">{caption}</Text>
      ) : null}
    </View>
  );
}

export const HeroBalanceCard = React.memo(HeroBalanceCardBase);
