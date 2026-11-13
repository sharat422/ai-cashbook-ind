import {personLabel} from '@utils/personLabel';
import React from 'react';
import {Alert, FlatList, RefreshControl, View} from 'react-native';

import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {StockItem, StockMove, Van} from '@features/stock/data/stock.remote';
import {formatQty} from '@features/stock/domain/qty';
import {useStockLevels, useStockMoves, useStockMutations} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate} from '@utils/date';

/** The stock audit log: every purchase, sale, van load and count correction.
 *  A wrong entry is undone with Reverse (a mirror entry), never edited. */
export function StockHistoryScreen({route}: AppScreenProps<'StockHistory'>): React.JSX.Element {
  const t = useT();
  const {itemId, name} = route.params ?? {};
  const moves = useStockMoves(itemId);
  const levels = useStockLevels();
  const items: StockItem[] = levels.data?.items ?? [];
  const vans: Van[] = levels.data?.vans ?? [];
  const {can} = usePermissions();
  const {reverse} = useStockMutations();
  const canReverse = (m: StockMove) =>
    can(PERMISSIONS.ENTRY_EDIT) && m.kind !== 'count' && !m.reversed && !m.reversesId;
  const confirmReverse = (m: StockMove) =>
    Alert.alert(t('stock.reverseTitle'), m.kind === 'sale' ? t('stock.reverseSaleMsg') : t('stock.reverseMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('stock.reverse'), style: 'destructive', onPress: () => reverse.mutate(m.id, {
        onError: e => Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : String(e)),
      })},
    ]);
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
              <Text className={`text-sm font-semibold ${m.reversed ? 'text-muted line-through' : 'text-slate-900'}`}>
                {m.reversesId ? `${t('stock.reversal')} · ` : ''}{t(`stock.kind.${m.kind}`)}
                {itemId ? '' : ` · ${items.find(i => i.id === m.itemId)?.name ?? ''}`}
              </Text>
              <Text variant="caption">
                {formatDisplayDate(m.date)} · {place(m.location, m.vanUserId)}
                {m.counted !== null ? ` · ${t('stock.countedQty', {qty: formatQty(m.counted)})}` : ''}
                {m.note && m.kind !== 'count' && !m.reversesId ? ` · ${m.note}` : ''}
              </Text>
              {m.reversed ? <Text testID={`reversed-${m.id}`} variant="caption">{t('stock.reversed')}</Text> : null}
              {canReverse(m) ? (
                <Button testID={`reverse-${m.id}`} title={t('stock.reverse')} variant="ghost" className="mt-1 self-start"
                  disabled={reverse.isPending} onPress={() => confirmReverse(m)} />
              ) : null}
            </View>
            <Text className={`text-sm font-bold ${m.quantity.startsWith('-') ? 'text-red-700' : 'text-green-700'}`}>
              {m.quantity.startsWith('-') ? '' : '+'}
              {formatQty(m.quantity)}
              {m.enteredUnit && m.enteredQty ? ` (${formatQty(m.enteredQty)} ${m.enteredUnit})` : ''}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}
