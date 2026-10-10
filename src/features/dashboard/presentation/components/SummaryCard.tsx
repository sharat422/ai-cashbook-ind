import React from 'react';
import {View} from 'react-native';

import {Icon, type IconName, Text} from '@components/ui';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

export type CardAccent = 'income' | 'expense' | 'neutral';

export interface SummaryCardProps {
  label: string;
  amount: number;
  icon: IconName;
  accent?: CardAccent;
  subtitle?: string;
}

const ICON_BG: Record<CardAccent, string> = {
  income: 'bg-green-50',
  expense: 'bg-red-50',
  neutral: 'bg-slate-100',
};

const ICON_COLOR: Record<CardAccent, string> = {
  income: colors.success,
  expense: colors.danger,
  neutral: colors.muted,
};

const AMOUNT_COLOR: Record<CardAccent, string> = {
  income: 'text-success',
  expense: 'text-danger',
  neutral: 'text-slate-900',
};

/**
 * Reusable dashboard metric card: icon chip, label, and a formatted INR amount.
 * Memoized — in a grid of cards only the ones whose props change re-render,
 * which matters on low-end devices.
 */
function SummaryCardBase({
  label,
  amount,
  icon,
  accent = 'neutral',
  subtitle,
}: SummaryCardProps): React.JSX.Element {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-white p-4">
      <View
        className={`h-9 w-9 items-center justify-center rounded-full ${ICON_BG[accent]}`}>
        <Icon name={icon} size={18} color={ICON_COLOR[accent]} />
      </View>
      <Text variant="caption" className="mt-3" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className={`mt-0.5 text-xl font-bold ${AMOUNT_COLOR[accent]}`}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {accent === 'expense' && amount > 0 ? '−' : ''}
        {formatINR(amount)}
      </Text>
      {subtitle ? (
        <Text variant="caption" className="mt-0.5" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export const SummaryCard = React.memo(SummaryCardBase);
