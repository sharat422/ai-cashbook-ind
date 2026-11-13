import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {resolveStockConflict, useStockQueue} from '@features/stock/data/stockQueue';
import {formatQty} from '@features/stock/domain/qty';
import {STOCK_KEY} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate, formatTimestamp} from '@utils/date';

/**
 * A stock entry made offline that the place no longer has the stock for
 * (someone sold it first). Queued vs now, side by side; nothing is saved —
 * and nothing is oversold — until a choice is made.
 */
export function StockConflictScreen({navigation, route}: AppScreenProps<'StockConflict'>): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const conflict = useStockQueue(s => s.conflicts.find(c => c.entry.input.clientId === route.params.clientId));
  const [busy, setBusy] = useState<'retry' | 'discard' | null>(null);

  if (!conflict) {
    return (
      <Screen>
        <View className="py-6">
          <Text variant="title">{t('stock.conflictTitle')}</Text>
          <Text variant="subtitle" className="mt-2">{t('sync.conflictNone')}</Text>
          <Button title={t('common.back')} variant="secondary" className="mt-6" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  const choose = async (choice: 'retry' | 'discard') => {
    setBusy(choice);
    try {
      await resolveStockConflict(conflict.entry.input.clientId, choice);
      await queryClient.invalidateQueries({queryKey: [STOCK_KEY]});
      const still = useStockQueue.getState().conflicts.some(c => c.entry.input.clientId === route.params.clientId);
      if (still) {
        if (conflict.entry.op === 'bill') Alert.alert(t('bill.conflictStillTitle'), t('bill.conflictStillMsg'));
        else Alert.alert(t('stock.conflictStillTitle'), t('stock.conflictStillMsg'));
        return;
      }
      navigation.goBack();
    } catch (err) {
      Alert.alert(t('form.couldNotSave'), err instanceof Error ? err.message : t('common.tryAgainMsg'));
    } finally {
      setBusy(null);
    }
  };

  const e = conflict.entry;
  const what = e.op === 'bill' ? t('bill.title')
    : e.op === 'transfer' ? t('stock.action.transfer') : t(`stock.kind.${e.input.kind}`);
  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{e.op === 'bill' ? t('bill.conflictTitle') : t('stock.conflictTitle')}</Text>
        <Text variant="subtitle" className="mt-1">{e.op === 'bill' ? t('bill.conflictExplain') : t('stock.conflictExplain')}</Text>
        <Text className="mt-4 text-base font-semibold">{what} · {e.itemName}</Text>
        <Text variant="caption">{formatDisplayDate(e.input.date)}</Text>

        {e.op === 'bill' ? (
          <View testID="conflict-reason" className="mt-4 rounded-xl border border-violet-300 bg-violet-50 p-3">
            <Text variant="caption">{t('bill.conflictReason')}</Text>
            <Text className="text-sm font-semibold">{conflict.reason}</Text>
          </View>
        ) : (
        <View className="mt-4 flex-row" style={{gap: 8}}>
          <View testID="conflict-queued" className="flex-1 rounded-xl border border-violet-300 bg-violet-50 p-3">
            <Text variant="caption">{t('stock.conflictQueued')}</Text>
            <Text className="text-lg font-bold">{formatQty(conflict.queued)}</Text>
          </View>
          <View testID="conflict-current" className="flex-1 rounded-xl border border-border bg-white p-3">
            <Text variant="caption">{t('stock.conflictCurrent')}</Text>
            <Text className="text-lg font-bold">{formatQty(conflict.current)}</Text>
          </View>
        </View>
        )}
        <Text variant="caption" className="mt-3">
          {t('sync.detectedAt', {time: formatTimestamp(conflict.detectedAt)})}
        </Text>

        <Button testID="stock-conflict-retry" title={t('stock.conflictRetry')} className="mt-6"
          loading={busy === 'retry'} disabled={busy !== null} onPress={() => choose('retry')} />
        <Button testID="stock-conflict-discard" title={t('stock.conflictDiscard')} variant="secondary" className="mt-3"
          loading={busy === 'discard'} disabled={busy !== null} onPress={() => choose('discard')} />
      </View>
    </Screen>
  );
}
