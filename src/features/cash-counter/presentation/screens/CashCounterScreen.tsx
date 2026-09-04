import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, TextInput, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {
  DENOMINATIONS,
  cashTotal,
  subtotal,
  totalPieces,
  type Counts,
} from '@features/cash-counter/domain/denominations';
import {useT} from '@/i18n';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';
import {onlyDigits} from '@utils/validation';

/** Physical cash counter: enter how many of each note/coin → live total. */
export function CashCounterScreen(): React.JSX.Element {
  const t = useT();
  const [counts, setCounts] = useState<Counts>({});

  const total = useMemo(() => cashTotal(counts), [counts]);
  const pieces = useMemo(() => totalPieces(counts), [counts]);

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

        {total > 0 ? (
          <Pressable className="mt-2 self-center" onPress={() => setCounts({})}>
            <Text className="text-sm font-semibold text-primary">{t('cash.reset')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}
