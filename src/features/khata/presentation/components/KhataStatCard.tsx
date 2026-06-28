import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {formatINR} from '@utils/currency';

type Accent = 'receivable' | 'payable' | 'overdue' | 'collections';

const ICON_BG: Record<Accent, string> = {
  receivable: 'bg-green-50',
  payable: 'bg-red-50',
  overdue: 'bg-amber-50',
  collections: 'bg-indigo-50',
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
  icon: string;
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
        <Text className="text-base">{icon}</Text>
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
