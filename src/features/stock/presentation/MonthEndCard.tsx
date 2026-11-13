import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {Pressable} from 'react-native';

import {Text} from '@components/ui';
import {stockRemote} from '@features/stock/data/stock.remote';
import {STOCK_KEY} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';

/** Home screen, owner: on the last 3 days of the month, until the month's
 *  stock count is confirmed (locked). A card, not a push notification. */
export function MonthEndCard({onPress}: {onPress: () => void}): React.JSX.Element | null {
  const t = useT();
  const status = useQuery({queryKey: [STOCK_KEY, 'month-status'], queryFn: () => stockRemote.monthStatus()});
  if (!status.data?.reminderDue) return null;
  return (
    <Pressable testID="month-end-card" accessibilityRole="button" onPress={onPress}
      className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <Text className="text-sm font-semibold text-amber-900">{t('stock.monthEndDue')}</Text>
      <Text variant="caption">{t('stock.monthEndDueMsg')}</Text>
    </Pressable>
  );
}
