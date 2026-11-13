import React from 'react';
import {View} from 'react-native';

import {Avatar, Text} from '@components/ui';
import {useT} from '@/i18n';
import type {KhataDefaulter} from '@features/khata/domain/entities';
import {formatINR} from '@utils/currency';

/** Ranked list of the biggest overdue customers. */
export function TopDefaultersList({
  defaulters,
}: {
  defaulters: KhataDefaulter[];
}): React.JSX.Element {
  const t = useT();
  if (defaulters.length === 0) {
    return <Text variant="caption">{t('khata.noOverdue')}</Text>;
  }
  return (
    <View style={{gap: 8}}>
      {defaulters.map((d, i) => (
        <View key={d.customerId} className="flex-row items-center">
          <Text className="w-5 text-sm font-bold text-muted">{i + 1}</Text>
          <Avatar name={d.name} size={36} />
          <View className="ml-3 flex-1">
            <Text className="text-sm font-semibold text-slate-900" numberOfLines={1}>
              {d.name}
            </Text>
            <Text className="text-[11px] text-danger">
              {t('khata.daysOverdue', {n: d.daysOverdue})}
            </Text>
          </View>
          <Text className="text-sm font-bold text-slate-900">
            {formatINR(d.amount)}
          </Text>
        </View>
      ))}
    </View>
  );
}
