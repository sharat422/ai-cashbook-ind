import React, {useState} from 'react';
import {FlatList, RefreshControl, View} from 'react-native';

import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {FilterChip} from '@components/filters';
import type {VanItem} from '@features/stock/data/stock.remote';
import {formatQty} from '@features/stock/domain/qty';
import {useVanStock} from '@features/stock/presentation/hooks';
import {StockMoveSheet, type StockAction} from '@features/stock/presentation/StockMoveSheet';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/** Staff: what's in my van; record a sale from it, or move it back to the
 *  godown. The server only ever returns the caller's own van. */
export function VanStockScreen(_: AppScreenProps<'VanStock'>): React.JSX.Element {
  const t = useT();
  const van = useVanStock();
  const [sheet, setSheet] = useState<{action: StockAction; item: VanItem} | null>(null);

  if (van.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-24 w-full" />
      </Screen>
    );
  }
  if (van.isError) {
    return (
      <Screen>
        <ErrorState onRetry={() => van.refetch()} retrying={van.isFetching} />
      </Screen>
    );
  }
  return (
    <Screen scroll={false}>
      <FlatList
        data={van.data ?? []}
        keyExtractor={i => i.id}
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40, gap: 12}}
        refreshControl={<RefreshControl refreshing={van.isRefetching} onRefresh={() => van.refetch()} />}
        ListHeaderComponent={<Text variant="title">{t('stock.myVan')}</Text>}
        ListEmptyComponent={<EmptyState icon="🚚" title={t('stock.vanEmpty')} message={t('stock.vanEmptyMsg')} />}
        renderItem={({item}: {item: VanItem}) => (
          <View className="flex-row items-center justify-between rounded-2xl border border-border bg-white p-4">
            <View className="flex-1">
              <Text className="text-base font-bold text-slate-900">{item.name}</Text>
              <Text variant="caption">{formatQty(item.quantity, item.unit)}</Text>
            </View>
            <View className="flex-row" style={{gap: 8}}>
              <FilterChip label={t('stock.action.sale')} selected={false} onPress={() => setSheet({action: 'sale', item})} />
              <FilterChip label={t('stock.action.move')} selected={false}
                onPress={() => setSheet({action: 'transfer', item})} />
            </View>
          </View>
        )}
      />
      <StockMoveSheet action={sheet?.action ?? null} item={sheet?.item ?? null} vans={[]} ownVanOnly
        onClose={() => setSheet(null)} />
    </Screen>
  );
}
