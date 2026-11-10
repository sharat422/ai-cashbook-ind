import {personLabel} from '@utils/personLabel';
import React from 'react';
import {FlatList, RefreshControl, View} from 'react-native';

import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {StockItem, StockMove, Van} from '@features/stock/data/stock.remote';
import {formatQty} from '@features/stock/domain/qty';
import {useStockLevels, useStockMoves} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate} from '@utils/date';

/** The stock audit log: every purchase, sale, van load and count correction. */
export function StockHistoryScreen({route}: AppScreenProps<'StockHistory'>): React.JSX.Element {
  const t = useT();
  const {itemId, name} = route.params ?? {};
  const moves = useStockMoves(itemId);
  const levels = useStockLevels();
  const items: StockItem[] = levels.data?.items ?? [];
  const vans: Van[] = levels.data?.vans ?? [];
  const place = (location: string, van: string | null) =>
    location === 'godown' ? `🏬 ${t('stock.godown')}` : `🚚 ${(v => personLabel(v?.name, v?.mobile))(vans.find(x => x.userId === van))}`;

  if (moves.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-24 w-full" />
      </Screen>
    );
  }
  if (moves.isError) {
    return (
      <Screen>
        <ErrorState onRetry={() => moves.refetch()} retrying={moves.isFetching} />
      </Screen>
    );
  }
  return (
    <Screen scroll={false}>
      <FlatList
        data={moves.data ?? []}
        keyExtractor={m => m.id}
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40, gap: 8}}
        refreshControl={<RefreshControl refreshing={moves.isRefetching} onRefresh={() => moves.refetch()} />}
        ListHeaderComponent={<Text variant="title">{name ?? t('stock.history')}</Text>}
        ListEmptyComponent={<EmptyState icon="🧾" title={t('stock.noHistory')} />}
        renderItem={({item: m}: {item: StockMove}) => (
          <View className="flex-row items-center justify-between rounded-2xl bg-white p-3">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-slate-900">
                {t(`stock.kind.${m.kind}`)}
                {itemId ? '' : ` · ${items.find(i => i.id === m.itemId)?.name ?? ''}`}
              </Text>
              <Text variant="caption">
                {formatDisplayDate(m.date)} · {place(m.location, m.vanUserId)}
                {m.counted !== null ? ` · ${t('stock.countedQty', {qty: formatQty(m.counted)})}` : ''}
                {m.note && m.kind !== 'count' ? ` · ${m.note}` : ''}
              </Text>
            </View>
            <Text className={`text-sm font-bold ${m.quantity.startsWith('-') ? 'text-red-700' : 'text-green-700'}`}>
              {m.quantity.startsWith('-') ? '' : '+'}
              {formatQty(m.quantity)}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}
