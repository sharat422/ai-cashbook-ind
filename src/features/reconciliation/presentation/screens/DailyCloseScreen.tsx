import React, {useState} from 'react';
import {RefreshControl, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField} from '@components/form';
import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {Beat} from '@features/beats/data/beats.remote';
import {useBeats} from '@features/beats/presentation/hooks';
import type {DailyClose} from '@features/reconciliation/data/reconciliation.remote';
import {formatMoney, isZero} from '@features/reconciliation/domain/money';
import {useDailyClose} from '@features/reconciliation/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

/**
 * Per beat and day: what was collected, how (cash / UPI / bank), credit given,
 * and the difference still to explain — non-cash collections not yet matched
 * to a bank line. ₹0.00 means every UPI/bank collection was found in the bank.
 * The server decides which beats a caller may see; staff get only their own.
 */
export function DailyCloseScreen({route}: AppScreenProps<'DailyClose'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const seesAll = can(PERMISSIONS.DATA_VIEW);
  const beatsQuery = useBeats();
  const beats: Beat[] = beatsQuery.data ?? [];
  const [picked, setPicked] = useState<string | undefined>(route.params?.beatId);
  const [date, setDate] = useState(toISODate(new Date()));
  // Staff have no whole-business view, so they always look at one of their beats.
  const beatId = picked ?? (seesAll ? undefined : beats[0]?.id);
  const close = useDailyClose(date, beatId, seesAll || beatId !== undefined);
  const data: DailyClose | undefined = close.data;

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={close.isRefetching} onRefresh={() => close.refetch()} />}>
        <Text variant="title">{t('close.title')}</Text>
        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          {seesAll ? (
            <FilterChip label={t('close.allBeats')} selected={beatId === undefined} onPress={() => setPicked(undefined)} />
          ) : null}
          {beats.map(b => (
            <FilterChip key={b.id} label={b.name} selected={beatId === b.id} onPress={() => setPicked(b.id)} />
          ))}
        </View>
        <View className="mt-3">
          <DateField value={date} onChange={setDate} />
        </View>

        {!seesAll && !beatsQuery.isLoading && beats.length === 0 ? (
          <EmptyState icon="🗺️" title={t('close.noBeat')} message={t('close.noBeatMsg')} />
        ) : close.isLoading || beatsQuery.isLoading ? (
          <Skeleton className="mt-6 h-40 w-full" />
        ) : close.isError ? (
          <ErrorState onRetry={() => close.refetch()} retrying={close.isFetching} />
        ) : data ? (
          <>
            <View className="mt-6 rounded-2xl border border-border bg-white p-4" style={{gap: 10}}>
              <Row
                label={t('close.recorded', {count: data.collections.length})}
                value={formatMoney(data.creditCollected)}
                bold
              />
              <Row label={t('close.cashInHand')} value={formatMoney(data.cashInHand)} />
              <Row label={t('close.upiClaimed')} value={formatMoney(data.upiClaimed)} />
              <Row label={t('close.bankClaimed')} value={formatMoney(data.bankClaimed)} />
              {!isZero(data.otherClaimed) ? (
                <Row label={t('close.otherClaimed')} value={formatMoney(data.otherClaimed)} />
              ) : null}
              <Row label={t('close.verified')} value={formatMoney(data.verified)} />
              <Row label={t('close.creditGiven')} value={formatMoney(data.creditGiven)} />
            </View>
            <View
              testID="close-difference"
              className={`mt-3 rounded-2xl p-4 ${isZero(data.difference) ? 'bg-green-50' : 'bg-red-50'}`}>
              <Row label={t('close.difference')} value={formatMoney(data.difference)} bold />
              <Text variant="caption" className="mt-1">
                {isZero(data.difference) ? t('close.allMatched') : t('close.differenceHint')}
              </Text>
            </View>

            {data.collections.map(c => (
              <View key={c.id} className="mt-3 flex-row items-center justify-between rounded-2xl bg-white p-3">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-slate-900">{c.customerName}</Text>
                  <Text variant="caption">
                    {(c.mode ?? '—').toUpperCase()}
                    {c.reference ? ` · ${c.reference}` : ''}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-semibold text-slate-900">{formatMoney(c.amount)}</Text>
                  <Text variant="caption">
                    {c.mode === 'cash' ? t('close.cash') : c.verified ? t('close.inBank') : t('close.notInBank')}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Row({label, value, bold}: {label: string; value: string; bold?: boolean}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={`text-sm ${bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{label}</Text>
      <Text className={`text-sm ${bold ? 'font-bold text-slate-900' : 'font-semibold text-slate-900'}`}>{value}</Text>
    </View>
  );
}
