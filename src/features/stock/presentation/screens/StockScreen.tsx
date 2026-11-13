import {personLabel} from '@utils/personLabel';
import React, {useState} from 'react';
import {FlatList, RefreshControl, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {StockItem, Van} from '@features/stock/data/stock.remote';
import {formatQty} from '@features/stock/domain/qty';
import {useStockLevels} from '@features/stock/presentation/hooks';
import {StockMoveSheet, type StockAction} from '@features/stock/presentation/StockMoveSheet';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/**
 * Owner/accountant: stock per item in the godown and each van, low-stock
 * alerts, and purchase / sale / load-van entries. Every change is logged.
 */
export function StockScreen({navigation}: AppScreenProps<'Stock'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const canEdit = can(PERMISSIONS.ENTRY_EDIT);
  const levels = useStockLevels();
  const [lowOnly, setLowOnly] = useState(false);
  const [sheet, setSheet] = useState<{action: StockAction; item: StockItem} | null>(null);

  if (levels.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-24 w-full" />
      </Screen>
    );
  }
  if (levels.isError || !levels.data) {
    return (
      <Screen>
        <ErrorState onRetry={() => levels.refetch()} retrying={levels.isFetching} />
      </Screen>
    );
  }
  const {items, vans}: {items: StockItem[]; vans: Van[]} = levels.data;
  const lowCount = items.filter(i => i.low).length;
  const shown = lowOnly ? items.filter(i => i.low) : items;
  const vanName = (userId: string) => {
    const v = vans.find(x => x.userId === userId);
    return v ? personLabel(v.name, v.mobile) : userId.slice(0, 6);
  };

  return (
    <Screen scroll={false}>
      <FlatList
        data={shown}
        keyExtractor={i => i.id}
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40, gap: 12}}
        refreshControl={<RefreshControl refreshing={levels.isRefetching} onRefresh={() => levels.refetch()} />}
        ListHeaderComponent={
          <View style={{gap: 12}}>
            <Text variant="title">{t('stock.title')}</Text>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              <FilterChip label={t('stock.all', {count: items.length})} selected={!lowOnly} onPress={() => setLowOnly(false)} />
              <FilterChip label={t('stock.lowFilter', {count: lowCount})} selected={lowOnly} onPress={() => setLowOnly(true)} />
            </View>
            {canEdit ? (
              <View className="flex-row" style={{gap: 8}}>
                <Button title={t('stock.count')} variant="secondary" className="flex-1"
                  onPress={() => navigation.navigate('StockCount')} />
                <Button title={t('stock.history')} variant="secondary" className="flex-1"
                  onPress={() => navigation.navigate('StockHistory', {})} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="📦" title={lowOnly ? t('stock.noLow') : t('stock.emptyTitle')}
            message={lowOnly ? undefined : t('stock.emptyMsg')} />
        }
        renderItem={({item}: {item: StockItem}) => (
          <View testID={`stock-${item.id}`} className="rounded-2xl border border-border bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-base font-bold text-slate-900">{item.name}</Text>
              {item.low ? (
                <Text className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{t('stock.lowBadge')}</Text>
              ) : null}
            </View>
            <Text className="mt-1 text-sm font-semibold text-slate-900">
              {t('stock.total', {qty: item.units?.length && item.display ? item.display : formatQty(item.total, item.unit)})}
              {item.lowStockThreshold ? ` · ${t('stock.alertBelow', {qty: formatQty(item.lowStockThreshold)})}` : ''}
            </Text>
            <Text variant="caption" className="mt-1">
              🏬 {t('stock.godown')}: {formatQty(item.godown)}
              {Object.entries(item.vans).map(([u, q]) => `   🚚 ${vanName(u)}: ${formatQty(q)}`).join('')}
            </Text>
            <View className="mt-3 flex-row flex-wrap" style={{gap: 8}}>
              {canEdit ? (
                <FilterChip label={t('stock.action.purchase')} selected={false}
                  onPress={() => setSheet({action: 'purchase', item})} />
              ) : null}
              <FilterChip label={t('stock.action.sale')} selected={false}
                onPress={() => setSheet({action: 'sale', item})} />
              {canEdit && vans.length > 0 ? (
                <FilterChip label={t('stock.action.transfer')} selected={false}
                  onPress={() => setSheet({action: 'transfer', item})} />
              ) : null}
              <FilterChip label={t('stock.log')} selected={false}
                onPress={() => navigation.navigate('StockHistory', {itemId: item.id, name: item.name})} />
            </View>
          </View>
        )}
      />
      <StockMoveSheet
        action={sheet?.action ?? null}
        item={sheet ? {...sheet.item, vanQty: sheet.item.vans} : null}
        vans={vans}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}
