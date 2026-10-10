import React from 'react';
import {View} from 'react-native';

import {Icon, type IconName, Text} from '@components/ui';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

type Accent = 'receivable' | 'payable' | 'overdue' | 'collections';

const ICON_BG: Record<Accent, string> = {
  receivable: 'bg-green-50',
  payable: 'bg-red-50',
  overdue: 'bg-amber-50',
  collections: 'bg-indigo-50',
};
const ICON_COLOR: Record<Accent, string> = {
  receivable: colors.success,
  payable: colors.danger,
  overdue: '#B45309',
  collections: colors.primary,
};
const VALUE_COLOR: Record<Accent, string> = {
  receivable: 'text-success',
  payable: 'text-danger',
  overdue: 'text-amber-700',
  collections: 'text-primary',
};

export interface KhataStatCardProps {
  label: string;
  amount: number;
  icon: IconName;
  accent: Accent;
  hero?: boolean;
}

/** Reusable executive metric card. */
function KhataStatCardBase({
  label,
  amount,
  icon,
  accent,
  hero,
}: KhataStatCardProps): React.JSX.Element {
  return (
    <View
      className="flex-1 rounded-2xl border border-border bg-white p-4"
      style={{
        shadowColor: '#0F172A',
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: {width: 0, height: 3},
        elevation: 2,
      }}>
      <View
        className={`h-9 w-9 items-center justify-center rounded-full ${ICON_BG[accent]}`}>
        <Icon name={icon} size={18} color={ICON_COLOR[accent]} />
      </View>
      <Text variant="caption" className="mt-3" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className={`mt-0.5 font-bold ${VALUE_COLOR[accent]} ${
          hero ? 'text-2xl' : 'text-xl'
        }`}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {formatINR(amount)}
      </Text>
    </View>
  );
}

export const KhataStatCard = React.memo(KhataStatCardBase);
