import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, TextInput, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {Button, Screen, Text} from '@components/ui';
import {
  DENOMINATIONS,
  cashTotal,
  countNote,
  subtotal,
  totalPieces,
  type Counts,
} from '@features/cash-counter/domain/denominations';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {Beat} from '@features/beats/data/beats.remote';
import {useBeats} from '@features/beats/presentation/hooks';
import {reconciliationRemote} from '@features/reconciliation/data/reconciliation.remote';
import {formatMoney} from '@features/reconciliation/domain/money';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {todayIST} from '@utils/date';
import {formatINR} from '@utils/currency';
import {onlyDigits} from '@utils/validation';

/** Physical cash counter: enter how many of each note/coin → live total, then save it as today's count. */
export function CashCounterScreen({navigation}: AppScreenProps<'CashCounter'>): React.JSX.Element {
  const t = useT();
  const [counts, setCounts] = useState<Counts>({});
  const [saving, setSaving] = useState(false);
  // Saved as Daily close's "Save count" does, for the beat picked as there: the owner can
  // also count the whole business; staff count one of their beats.
  const seesAll = usePermissions().can(PERMISSIONS.DATA_VIEW);
  const beats: Beat[] = useBeats().data ?? [];
  const [picked, setPicked] = useState<string | undefined>();
  const beatId = picked ?? (seesAll ? undefined : beats[0]?.id);

  const total = useMemo(() => cashTotal(counts), [counts]);
  const pieces = useMemo(() => totalPieces(counts), [counts]);

  const save = async () => {
    setSaving(true);
    try {
      const close = await reconciliationRemote.cashCount(todayIST(), beatId, total.toFixed(2), undefined, countNote(counts));
      const diff = close.cashOverShort;
      const vsRecorded = diff == null ? '' : Number(diff) === 0 ? t('close.countMatches')
        : `${Number(diff) < 0 ? t('close.short') : t('close.over')} ${formatMoney(Math.abs(Number(diff)).toFixed(2))}`;
      Alert.alert(t('cash.saved'), [`${t('close.cashCounted')} ${formatINR(total)}`, vsRecorded].filter(Boolean).join('\n'), [
        {text: t('common.ok')},
        {text: t('close.title'), onPress: () => navigation.navigate('DailyClose', beatId ? {beatId} : undefined)},
      ]);
    } catch (e) {
      Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setSaving(false);
    }
  };

  const setCount = (denom: number, text: string) => {
    const n = Number(onlyDigits(text));
    setCounts(prev => ({...prev, [denom]: Number.isNaN(n) ? 0 : n}));
  };

  return (
    <Screen scroll={false}>
      <View className="flex-1 py-6">
        <Text variant="title">{t('cash.title')}</Text>
        <Text variant="subtitle" className="mt-1">
          {t('cash.subtitle')}
        </Text>

        <ScrollView
          className="mt-5 flex-1"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Header row */}
          <View className="flex-row px-1 pb-2">
            <Text variant="caption" className="w-20">
              {t('cash.noteCoin')}
            </Text>
            <Text variant="caption" className="flex-1 text-center">
              {t('cash.count')}
            </Text>
            <Text variant="caption" className="w-28 text-right">
              {t('cash.subtotal')}
            </Text>
          </View>

          <View style={{gap: 8}}>
            {DENOMINATIONS.map(denom => {
              const count = counts[denom] || 0;
              return (
                <View
                  key={denom}
                  className="flex-row items-center rounded-xl border border-border bg-white px-3 py-2.5">
                  <Text className="w-20 text-base font-semibold text-slate-900">
                    ₹{denom}
                  </Text>
                  <View className="flex-1 items-center">
                    <TextInput
                      className="h-9 w-24 rounded-lg border border-border text-center text-base text-slate-900"
                      value={count ? String(count) : ''}
                      onChangeText={t => setCount(denom, t)}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                      maxLength={5}
                    />
                  </View>
                  <Text className="w-28 text-right text-base font-semibold text-slate-900">
                    {formatINR(subtotal(denom, count))}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Total bar */}
        <View className="mt-3 rounded-2xl bg-slate-900 px-5 py-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs uppercase tracking-wide text-slate-400">
                {t('cash.totalCash')}
              </Text>
              <Text className="mt-0.5 text-xs text-slate-400">
                {pieces === 1
                  ? t('cash.pieceOne')
                  : t('cash.pieces', {count: pieces})}
              </Text>
            </View>
            <Text
              className="text-3xl font-bold text-white"
              numberOfLines={1}
              adjustsFontSizeToFit>
              {formatINR(total)}
            </Text>
          </View>
        </View>

        {beats.length > (seesAll ? 0 : 1) ? (
          <View testID="cash-beat" className="mt-3 flex-row flex-wrap" style={{gap: 8}}>
            {seesAll ? (
              <FilterChip label={t('close.allBeats')} selected={beatId === undefined} onPress={() => setPicked(undefined)} />
            ) : null}
            {beats.map(b => (
              <FilterChip key={b.id} label={b.name} selected={beatId === b.id} onPress={() => setPicked(b.id)} />
            ))}
          </View>
        ) : null}
        <Button testID="cash-save" title={t('close.saveCount')} className="mt-3" loading={saving}
          disabled={total <= 0 || saving} onPress={save} />
        <Text variant="caption" className="mt-1 text-center">{t('cash.saveHint', {screen: t('close.title')})}</Text>

        {total > 0 ? (
          <Pressable className="mt-2 self-center" onPress={() => setCounts({})}>
            <Text className="text-sm font-semibold text-primary">{t('cash.reset')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}
