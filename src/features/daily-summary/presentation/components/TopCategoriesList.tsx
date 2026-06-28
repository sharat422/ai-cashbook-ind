import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import type {CategoryTotal} from '@features/daily-summary/domain/entities';
import {formatINR} from '@utils/currency';

/** Horizontal bars showing each top category's spend and share. */
export function TopCategoriesList({
  categories,
}: {
  categories: CategoryTotal[];
}): React.JSX.Element {
  if (categories.length === 0) {
    return <Text variant="caption">No expenses recorded today.</Text>;
  }
  return (
    <View style={{gap: 12}}>
      {categories.map(cat => {
        const pct = Math.round(cat.share * 100);
        return (
          <View key={cat.category}>
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-slate-800">
                {cat.category}
              </Text>
              <Text className="text-sm font-semibold text-slate-900">
                {formatINR(cat.amount)}
                <Text className="text-xs text-muted"> · {pct}%</Text>
              </Text>
            </View>
            <View className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <View
                className="h-full rounded-full bg-primary"
                style={{width: `${Math.max(pct, 3)}%`}}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
