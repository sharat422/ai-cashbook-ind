import React from 'react';
import {RefreshControl, ScrollView, View} from 'react-native';

import {ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {BusinessSummary} from '@features/business/data/business.remote';
import {useBusinessSummary} from '@features/business/presentation/hooks';
import {useT, type TKey} from '@/i18n';
import {useAuthStore} from '@store/auth.store';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

function greetingKey(): TKey {
  const h = new Date().getHours();
  if (h < 12) return 'business.morning';
  if (h < 17) return 'business.afternoon';
  return 'business.evening';
}

export function BusinessScreen(): React.JSX.Element {
  const t = useT();
  const businessName = useAuthStore(s => s.business?.businessName);
  const {data, isLoading, isError, error, refetch, isRefetching} =
    useBusinessSummary();

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }>
        <Text variant="title">{t(greetingKey())} 👋</Text>
        <Text variant="subtitle" className="mt-0.5">
          {t('business.pulse', {
            name: businessName ?? t('dashboard.yourBusiness'),
          })}
        </Text>

        {isLoading && !data ? (
          <View className="mt-5" style={{gap: 12}}>
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </View>
        ) : isError && !data ? (
          <View className="mt-6">
            <ErrorState
              message={error?.message ?? t('business.loadError')}
              onRetry={refetch}
              retrying={isRefetching}
            />
          </View>
        ) : data ? (
          <Body data={data} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Body({data}: {data: BusinessSummary}): React.JSX.Element {
  const t = useT();
  return (
    <View className="mt-5" style={{gap: 16}}>
      {/* Yesterday digest */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-3">
          {t('business.yesterday')}
        </Text>
        <View className="flex-row" style={{gap: 10}}>
          <Metric label={t('business.sales')} value={formatINR(data.yesterday.sales)} tone="income" />
          <Metric
            label={t('business.collections')}
            value={formatINR(data.yesterday.collections)}
            tone="income"
          />
          <Metric label={t('business.expenses')} value={formatINR(data.yesterday.expenses)} tone="expense" />
        </View>
      </View>

      {/* Receivables */}
      <View className="rounded-2xl bg-slate-900 p-4">
        <View className="flex-row" style={{gap: 10}}>
          <DarkMetric label={t('business.outstanding')} value={formatINR(data.outstanding)} />
          <DarkMetric label={t('business.overdue')} value={formatINR(data.overdue)} accent="text-red-300" />
        </View>
        <View className="mt-3 flex-row" style={{gap: 10}}>
          <DarkMetric
            label={t('business.expectedToday')}
            value={formatINR(data.expectedCollectionToday)}
            accent="text-green-300"
          />
          <DarkMetric
            label={t('business.needAttention')}
            value={`${data.customersNeedAttention}`}
            accent="text-amber-300"
          />
        </View>
      </View>

      {/* Profit dashboard (#29) */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-3">
          {t('business.thisMonth')}
        </Text>
        <View className="flex-row" style={{gap: 10}}>
          <Metric label={t('business.sales')} value={formatINR(data.month.sales)} tone="income" />
          <Metric label={t('business.expenses')} value={formatINR(data.month.expenses)} tone="expense" />
        </View>
        <View className="mt-3 rounded-xl bg-slate-50 p-3 flex-row items-center justify-between">
          <View>
            <Text variant="caption">{t('business.estProfit')}</Text>
            <Text
              className={`mt-0.5 text-xl font-bold ${
                data.month.profit >= 0 ? 'text-success' : 'text-danger'
              }`}>
              {formatINR(data.month.profit)}
            </Text>
          </View>
          <View className="items-end">
            <Text variant="caption">{t('business.margin')}</Text>
            <Text className="mt-0.5 text-xl font-bold text-slate-900">
              {Math.round(data.month.margin * 100)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Trends (#30) */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-3">
          {t('business.trends')}
        </Text>
        <View style={{gap: 8}}>
          <Trend label={t('business.sales')} pct={data.trends.salesPct} goodUp />
          <Trend label={t('business.collections')} pct={data.trends.collectionsPct} goodUp />
          <Trend label={t('business.expenses')} pct={data.trends.expensesPct} goodUp={false} />
        </View>
      </View>

      {/* Forecast (#31) */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-1">
          {t('business.forecast')}
        </Text>
        <Text variant="caption" className="mb-3">
          {t('business.forecastBasis')}
        </Text>
        <View className="flex-row" style={{gap: 10}}>
          <Metric
            label={t('business.expectedIn')}
            value={formatINR(data.forecast.expectedCollections)}
            tone="income"
          />
          <Metric
            label={t('business.expectedOut')}
            value={formatINR(data.forecast.expectedExpenses)}
            tone="expense"
          />
          <Metric
            label={t('business.net')}
            value={formatINR(data.forecast.net)}
            tone={data.forecast.net >= 0 ? 'income' : 'expense'}
          />
        </View>
      </View>
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'income' | 'expense';
}): React.JSX.Element {
  return (
    <View className="flex-1">
      <Text className="text-[10px] uppercase text-muted">{label}</Text>
      <Text
        className={`mt-0.5 text-base font-bold ${
          tone === 'income' ? 'text-success' : 'text-danger'
        }`}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function DarkMetric({
  label,
  value,
  accent = 'text-white',
}: {
  label: string;
  value: string;
  accent?: string;
}): React.JSX.Element {
  return (
    <View className="flex-1">
      <Text className="text-[10px] uppercase text-slate-400">{label}</Text>
      <Text
        className={`mt-0.5 text-lg font-bold ${accent}`}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function Trend({
  label,
  pct,
  goodUp,
}: {
  label: string;
  pct: number | null;
  goodUp: boolean;
}): React.JSX.Element {
  const t = useT();
  if (pct === null) {
    return (
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-slate-700">{label}</Text>
        <Text variant="caption">{t('business.noPriorData')}</Text>
      </View>
    );
  }
  const up = pct >= 0;
  const good = up === goodUp;
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-slate-700">{label}</Text>
      <Text
        className={`text-sm font-semibold ${good ? 'text-success' : 'text-danger'}`}>
        {up ? '▲' : '▼'} {Math.abs(pct)}%
      </Text>
    </View>
  );
}
