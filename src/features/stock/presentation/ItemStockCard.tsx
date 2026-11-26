import React, {useState} from 'react';
import {View} from 'react-native';

import {FilterChip} from '@components/filters';
import {Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {StockItem, StockMove, Van} from '@features/stock/data/stock.remote';
import {formatQty} from '@features/stock/domain/qty';
import {useStockLevels, useStockMoves} from '@features/stock/presentation/hooks';
import {StockMoveSheet, type StockAction} from '@features/stock/presentation/StockMoveSheet';
import {useT, type TKey} from '@/i18n';
import {formatDisplayDate} from '@utils/date';

/**
 * On an item's detail (Settings → Item catalog → the item): its stock now, stock
 * in (a purchase into the godown) and stock out (a sale), and its latest
 * movements. The same sheet, figures and history as the 📦 Stock screen; the
 * server changes the quantity and writes the movement together.
 */
export function ItemStockCard({itemId, onHistory}: {itemId: string; onHistory: () => void}): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const levels = useStockLevels();
  const moves = useStockMoves(itemId);
  const [action, setAction] = useState<StockAction | null>(null);
  const item = (levels.data?.items ?? []).find((i: StockItem) => i.id === itemId);
  const vans: Van[] = levels.data?.vans ?? [];
  const recent: StockMove[] = (moves.data ?? []).slice(0, 5);

  return (
    <View testID="item-stock" className="rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
      <Text className="text-sm font-semibold">{t('stock.title')}</Text>
      <Text testID="item-stock-now" className="text-base font-bold text-slate-900">
        {item ? t('stock.total', {qty: item.units?.length && item.display ? item.display : formatQty(item.total, item.unit)})
          : levels.isLoading ? '…' : t('stock.total', {qty: '0'})}
      </Text>
      <View className="flex-row flex-wrap" style={{gap: 8}}>
        {can(PERMISSIONS.ENTRY_EDIT) ? (
          <FilterChip testID="item-stock-in" label={t('stock.action.purchase')} selected={false}
            onPress={() => setAction('purchase')} />
        ) : null}
        <FilterChip testID="item-stock-out" label={t('stock.action.sale')} selected={false}
          onPress={() => setAction('sale')} />
        <FilterChip testID="item-stock-history" label={t('stock.log')} selected={false} onPress={onHistory} />
      </View>
      {recent.length === 0 ? (
        <Text variant="caption">{moves.isLoading ? '…' : t('stock.noHistory')}</Text>
      ) : recent.map(m => (
        <View key={m.id} testID="item-stock-move" className="flex-row justify-between border-t border-border pt-2">
          <Text variant="caption" className="flex-1">
            {formatDisplayDate(m.date)} · {t(`stock.kind.${m.kind}` as TKey)}
            {m.billRef ? ` · ${t('stock.billNo', {ref: m.billRef})}` : ''}
          </Text>
          <Text className={`text-sm font-semibold ${m.quantity.startsWith('-') ? 'text-red-700' : 'text-green-700'}`}>
            {m.quantity.startsWith('-') ? '' : '+'}{formatQty(m.quantity)}
          </Text>
        </View>
      ))}
      <StockMoveSheet
        action={item ? action : null}
        item={item ? {...item, vanQty: item.vans} : null}
        vans={vans}
        onClose={() => setAction(null)}
      />
    </View>
  );
}
