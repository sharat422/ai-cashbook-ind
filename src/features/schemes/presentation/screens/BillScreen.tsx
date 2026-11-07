import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, TextField} from '@components/form';
import {Button, Screen, Select, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {itemRemote} from '@features/items/data/item.remote';
import type {Item} from '@features/items/domain/entities';
import {formatMoney} from '@features/reconciliation/domain/money';
import {schemesRemote, type BillInput, type BillPreview, type PreviewLine} from '@features/schemes/data/schemes.remote';
import {makeBillClientId, useCreateBill} from '@features/schemes/presentation/hooks';
import type {Van, VanItem} from '@features/stock/data/stock.remote';
import {formatQty, isQty} from '@features/stock/domain/qty';
import {useStockLevels, useVanStock} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';
import {todayIST} from '@utils/date';

interface Line {
  itemId: string;
  quantity: string;
}

/**
 * An item bill to a retailer. Schemes are applied by the server and shown as
 * their own lines; saving puts the total on the retailer's credit and takes
 * the goods (paid + free) out of the godown or the salesperson's van.
 */
export function BillScreen({navigation, route}: AppScreenProps<'Bill'>): React.JSX.Element {
  const t = useT();
  const {customer, beatId} = route.params;
  const {can} = usePermissions();
  const seesAll = can(PERMISSIONS.DATA_VIEW); // owner/accountant: any place, full catalog
  const catalog = useQuery({
    queryKey: ['items', 'bill'],
    queryFn: () => itemRemote.list('', 100),
    enabled: seesAll,
  });
  const levels = useStockLevels();
  const myVan = useVanStock();
  const vans: Van[] = seesAll ? levels.data?.vans ?? [] : [];
  const vanItems: VanItem[] = myVan.data ?? [];
  const catalogItems: Item[] = catalog.data?.items ?? [];
  const products: {id: string; name: string; unit: string | null}[] = seesAll
    ? catalogItems.filter(i => i.type === 'product').map(i => ({id: i.id, name: i.name, unit: i.unit ?? null}))
    : vanItems.map(i => ({id: i.id, name: i.name, unit: i.unit}));

  const [where, setWhere] = useState<string>(seesAll ? 'godown' : 'myvan'); // 'godown' | 'myvan' | van user id
  const [date, setDate] = useState(todayIST());
  const [lines, setLines] = useState<Line[]>([]);
  const [clientId] = useState(makeBillClientId);
  const createBill = useCreateBill();

  const input: BillInput = {
    clientId,
    customerId: customer.id,
    date,
    location: where === 'godown' ? 'godown' : 'van',
    vanUserId: where === 'godown' || where === 'myvan' ? undefined : where,
    beatId,
    lines: lines.filter(l => isQty(l.quantity)).map(l => ({itemId: l.itemId, quantity: l.quantity})),
  };
  const debounced = useDebouncedValue(input);
  const preview = useQuery<BillPreview>({
    queryKey: ['bill-preview', debounced],
    queryFn: () => schemesRemote.preview(debounced),
    enabled: debounced.lines.length > 0,
    retry: false,
  });

  const unused = products.filter(p => !lines.some(l => l.itemId === p.id));
  const byName = new Map(unused.map(p => [p.name, p.id]));
  const nameOf = (id: string) => products.find(p => p.id === id)?.name ?? '';
  const setQty = (itemId: string, q: string) =>
    setLines(ls => ls.map(l => (l.itemId === itemId ? {...l, quantity: q.replace(/[^\d.]/g, '')} : l)));

  const save = () =>
    createBill.mutate(
      input,
      {
        onSuccess: bill => {
          Alert.alert(
            t('bill.savedTitle', {number: bill.billNumber}),
            t('bill.savedMsg', {total: formatMoney(bill.total), name: customer.fullName}),
          );
          navigation.goBack();
        },
        onError: e => Alert.alert(t('form.couldNotSave'), e.message),
      },
    );

  const p: BillPreview | undefined = preview.data;
  const ready = input.lines.length > 0 && input.lines.length === lines.length;
  return (
    <Screen scroll={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}>
        <Text variant="title">{t('bill.title')}</Text>
        <Text variant="subtitle" className="mt-1">{customer.fullName}</Text>

        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          {seesAll ? (
            <FilterChip label={`🏬 ${t('stock.godown')}`} selected={where === 'godown'} onPress={() => setWhere('godown')} />
          ) : (
            <FilterChip label={t('stock.myVan')} selected onPress={() => undefined} />
          )}
          {vans.map(v => (
            <FilterChip key={v.userId} label={`🚚 ${v.mobile}`} selected={where === v.userId}
              onPress={() => setWhere(v.userId)} />
          ))}
        </View>
        <View className="mt-3">
          <DateField value={date} onChange={setDate} />
        </View>

        <View className="mt-5" style={{gap: 10}}>
          {lines.map(l => {
            const pl: PreviewLine | undefined = p?.lines.find((x: PreviewLine) => x.itemId === l.itemId);
            return (
              <View key={l.itemId} testID={`bill-line-${l.itemId}`} className="rounded-2xl border border-border bg-white p-3">
                <View className="flex-row items-center" style={{gap: 10}}>
                  <Text className="flex-1 text-sm font-semibold text-slate-900">{nameOf(l.itemId)}</Text>
                  <View style={{width: 90}}>
                    <TextField value={l.quantity} onChangeText={q => setQty(l.itemId, q)} keyboardType="decimal-pad"
                      placeholder={t('stock.quantity')} accessibilityLabel={t('bill.qtyFor', {name: nameOf(l.itemId)})} />
                  </View>
                  <Pressable accessibilityLabel={t('bill.removeLine')} onPress={() => setLines(ls => ls.filter(x => x.itemId !== l.itemId))}>
                    <Text className="text-lg text-slate-400">✕</Text>
                  </Pressable>
                </View>
                {pl ? (
                  <Text variant="caption" className="mt-1">
                    {formatQty(pl.quantity, pl.unit)} × {formatMoney(pl.rate)} = {formatMoney(pl.amount)}
                  </Text>
                ) : null}
                {pl?.scheme ? (
                  <View testID={`scheme-line-${l.itemId}`} className="mt-2 rounded-xl bg-green-50 px-3 py-2">
                    <Text className="text-sm font-semibold text-green-800">🎁 {pl.scheme.name}</Text>
                    <Text className="text-xs text-green-800">
                      {Number(pl.scheme.freeQty) > 0
                        ? t('bill.freeGoods', {qty: formatQty(pl.scheme.freeQty), item: pl.scheme.freeItemName ?? ''})
                        : t('bill.discount', {amount: formatMoney(pl.scheme.discount)})}
                      {' · '}
                      {t('bill.schemeValue', {amount: formatMoney(pl.scheme.value)})}
                    </Text>
                  </View>
                ) : null}
                {pl?.notApplied.map((x: PreviewLine['notApplied'][number]) => (
                  <Text key={x.schemeId} variant="caption" className="mt-1">⏸ {x.name}: {x.reason}</Text>
                ))}
              </View>
            );
          })}
        </View>

        {unused.length > 0 ? (
          <View className="mt-3">
            <Select
              label={t('bill.addItem')}
              placeholder={t('bill.addItemPlaceholder')}
              options={unused.map(u => u.name)}
              value={null}
              onSelect={name => {
                const id = byName.get(name);
                if (id) setLines(ls => [...ls, {itemId: id, quantity: ''}]);
              }}
            />
          </View>
        ) : products.length === 0 ? (
          <Text variant="caption" className="mt-3">{seesAll ? t('bill.noItems') : t('stock.vanEmptyMsg')}</Text>
        ) : null}

        {preview.isError ? (
          <Text className="mt-4 text-sm text-danger">{(preview.error as Error).message}</Text>
        ) : p ? (
          <View testID="bill-totals" className="mt-5 rounded-2xl bg-slate-900 p-4" style={{gap: 6}}>
            <Total label={t('bill.subtotal')} value={formatMoney(p.subtotal)} />
            <Total label={t('bill.schemeDiscount')} value={`−${formatMoney(p.discount)}`} />
            <Total label={t('bill.total')} value={formatMoney(p.total)} bold />
          </View>
        ) : null}

        <Text variant="caption" className="mt-4">{t('bill.hint')}</Text>
        <Button title={t('bill.save')} className="mt-3" disabled={!ready || !p || preview.isFetching}
          loading={createBill.isPending} onPress={save} />
      </ScrollView>
    </Screen>
  );
}

function Total({label, value, bold}: {label: string; value: string; bold?: boolean}) {
  return (
    <View className="flex-row justify-between">
      <Text className={`text-sm ${bold ? 'font-bold' : ''} text-white`}>{label}</Text>
      <Text className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} text-white`}>{value}</Text>
    </View>
  );
}
