import {personLabel} from '@utils/personLabel';
import React, {useMemo, useState} from 'react';
import {Alert, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, TextField} from '@components/form';
import {Button, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {CountResult, StockItem, Van} from '@features/stock/data/stock.remote';
import {difference, formatQty, isQty, toMilli} from '@features/stock/domain/qty';
import {makeStockClientId, useStockLevels, useStockMutations} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {todayIST} from '@utils/date';

/**
 * Monthly stock count for one place (godown or a van): system stock next to
 * the physical count, the difference, and on save a logged correction so
 * system stock equals what was counted. The server decides "within ±2%".
 */
export function StockCountScreen(_: AppScreenProps<'StockCount'>): React.JSX.Element {
  const t = useT();
  const levels = useStockLevels();
  const {count} = useStockMutations();
  const [where, setWhere] = useState<string>('godown'); // 'godown' or a van user id
  const [date, setDate] = useState(todayIST());
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CountResult | null>(null);
  const [clientId, setClientId] = useState(makeStockClientId);

  const items: StockItem[] = useMemo(() => levels.data?.items ?? [], [levels.data]);
  const vans: Van[] = levels.data?.vans ?? [];
  const system = (id: string) => {
    const it = items.find(i => i.id === id);
    if (!it) return '0';
    return where === 'godown' ? it.godown : it.vans[where] ?? '0.000';
  };

  if (levels.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-40 w-full" />
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

  const entered = Object.entries(counted).filter(([, v]) => v.trim() !== '');
  const invalid = entered.some(([, v]) => !isQty(v, true));
  const pick = (w: string) => {
    setWhere(w);
    setCounted({});
    setResult(null);
    setClientId(makeStockClientId());
  };

  const save = () =>
    count.mutate(
      {
        clientId,
        location: where === 'godown' ? 'godown' : 'van',
        vanUserId: where === 'godown' ? undefined : where,
        date,
        lines: entered.map(([itemId, v]) => ({itemId, counted: v.trim()})),
      },
      {
        onSuccess: (r: CountResult) => {
          setResult(r);
          setCounted({});
          setClientId(makeStockClientId());
        },
        onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message),
      },
    );

  const nameOf = (id: string) => items.find(i => i.id === id)?.name ?? '';
  const unitOf = (id: string) => items.find(i => i.id === id)?.unit ?? null;

  return (
    <Screen scroll={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}>
        <Text variant="title">{t('stock.countTitle')}</Text>
        <Text variant="caption" className="mt-1">{t('stock.countHint')}</Text>
        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          <FilterChip label={`🏬 ${t('stock.godown')}`} selected={where === 'godown'} onPress={() => pick('godown')} />
          {vans.map(v => (
            <FilterChip key={v.userId} label={`🚚 ${personLabel(v.name, v.mobile)}`} selected={where === v.userId}
              onPress={() => pick(v.userId)} />
          ))}
        </View>
        <View className="mt-3">
          <DateField value={date} onChange={setDate} />
        </View>

        {result ? (
          <View testID="count-result" className="mt-5 rounded-2xl border border-border bg-white p-4" style={{gap: 10}}>
            <Text className={`text-sm font-bold ${result.allWithinTolerance ? 'text-green-700' : 'text-red-700'}`}>
              {result.allWithinTolerance ? t('stock.countAllMatched') : t('stock.countSomeOff')}
            </Text>
            {result.lines.map(l => (
              <View key={l.itemId} className="flex-row justify-between">
                <Text className="flex-1 text-sm text-slate-900">{nameOf(l.itemId)}</Text>
                <Text className={`text-sm font-semibold ${l.withinTolerance ? 'text-green-700' : 'text-red-700'}`}>
                  {toMilli(l.difference) === 0
                    ? t('stock.exact')
                    : `${formatQty(l.difference, unitOf(l.itemId))}${l.differencePct ? ` (${l.differencePct}%)` : ''}${
                        l.withinTolerance ? ` · ${t('stock.within2')}` : ''
                      }`}
                </Text>
              </View>
            ))}
            <Text variant="caption">{t('stock.countLogged')}</Text>
          </View>
        ) : null}

        <View className="mt-5" style={{gap: 10}}>
          {items.map(it => {
            const sys = system(it.id);
            const v = counted[it.id] ?? '';
            const diff = v.trim() && isQty(v, true) ? difference(v, sys) : null;
            return (
              <View key={it.id} className="rounded-2xl border border-border bg-white p-3">
                <View className="flex-row items-center" style={{gap: 10}}>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-slate-900">{it.name}</Text>
                    <Text variant="caption">{t('stock.system', {qty: formatQty(sys, it.unit)})}</Text>
                  </View>
                  <View style={{width: 110}}>
                    <TextField
                      value={v}
                      onChangeText={x => setCounted(c => ({...c, [it.id]: x.replace(/[^\d.]/g, '')}))}
                      keyboardType="decimal-pad"
                      placeholder={t('stock.counted')}
                      accessibilityLabel={t('stock.countedFor', {name: it.name})}
                    />
                  </View>
                </View>
                {diff !== null ? (
                  <Text variant="caption" className="mt-1">{t('stock.diff', {qty: formatQty(diff, it.unit)})}</Text>
                ) : null}
              </View>
            );
          })}
        </View>

        <Button title={t('stock.saveCount', {count: entered.length})} className="mt-6"
          disabled={entered.length === 0 || invalid} loading={count.isPending} onPress={save} />
      </ScrollView>
    </Screen>
  );
}
