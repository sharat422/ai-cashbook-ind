import React from 'react';
import {RefreshControl, ScrollView, View} from 'react-native';

import {ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {BusinessSummary} from '@features/business/data/business.remote';
import {useBusinessSummary} from '@features/business/presentation/hooks';
import {useAuthStore} from '@store/auth.store';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function BusinessScreen(): React.JSX.Element {
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
        <Text variant="title">{greeting()} 👋</Text>
        <Text variant="subtitle" className="mt-0.5">
          {businessName ?? 'Your business'} · today’s pulse
        </Text>

        {isLoading && !data ? (
          <View className="mt-5" style={{gap: 12}}>
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </View>
        ) : isError && !data ? (
          <View className="mt-6">
            <ErrorState
              message={error?.message ?? 'Could not load the summary.'}
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
  return (
    <View className="mt-5" style={{gap: 16}}>
      {/* Yesterday digest */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-3">
          Yesterday
        </Text>
        <View className="flex-row" style={{gap: 10}}>
          <Metric label="Sales" value={formatINR(data.yesterday.sales)} tone="income" />
          <Metric
            label="Collections"
            value={formatINR(data.yesterday.collections)}
            tone="income"
          />
          <Metric label="Expenses" value={formatINR(data.yesterday.expenses)} tone="expense" />
        </View>
      </View>

      {/* Receivables */}
      <View className="rounded-2xl bg-slate-900 p-4">
        <View className="flex-row" style={{gap: 10}}>
          <DarkMetric label="Outstanding" value={formatINR(data.outstanding)} />
          <DarkMetric label="Overdue" value={formatINR(data.overdue)} accent="text-red-300" />
        </View>
        <View className="mt-3 flex-row" style={{gap: 10}}>
          <DarkMetric
            label="Expected today"
            value={formatINR(data.expectedCollectionToday)}
            accent="text-green-300"
          />
          <DarkMetric
            label="Need attention"
            value={`${data.customersNeedAttention}`}
            accent="text-amber-300"
          />
        </View>
      </View>

      {/* Profit dashboard (#29) */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-3">
          This month
        </Text>
        <View className="flex-row" style={{gap: 10}}>
          <Metric label="Sales" value={formatINR(data.month.sales)} tone="income" />
          <Metric label="Expenses" value={formatINR(data.month.expenses)} tone="expense" />
        </View>
        <View className="mt-3 rounded-xl bg-slate-50 p-3 flex-row items-center justify-between">
          <View>
            <Text variant="caption">Estimated profit</Text>
            <Text
              className={`mt-0.5 text-xl font-bold ${
                data.month.profit >= 0 ? 'text-success' : 'text-danger'
              }`}>
              {formatINR(data.month.profit)}
            </Text>
          </View>
          <View className="items-end">
            <Text variant="caption">Margin</Text>
            <Text className="mt-0.5 text-xl font-bold text-slate-900">
              {Math.round(data.month.margin * 100)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Trends (#30) */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-3">
          Trends vs last month
        </Text>
        <View style={{gap: 8}}>
          <Trend label="Sales" pct={data.trends.salesPct} goodUp />
          <Trend label="Collections" pct={data.trends.collectionsPct} goodUp />
          <Trend label="Expenses" pct={data.trends.expensesPct} goodUp={false} />
        </View>
      </View>

      {/* Forecast (#31) */}
      <View className="rounded-2xl border border-border bg-white p-4">
        <Text variant="label" className="mb-1">
          Cash-flow forecast
        </Text>
        <Text variant="caption" className="mb-3">
          Based on your last 3 months
        </Text>
        <View className="flex-row" style={{gap: 10}}>
          <Metric
            label="Expected in"
            value={formatINR(data.forecast.expectedCollections)}
            tone="income"
          />
          <Metric
            label="Expected out"
            value={formatINR(data.forecast.expectedExpenses)}
            tone="expense"
          />
          <Metric
            label="Net"
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
  if (pct === null) {
    return (
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-slate-700">{label}</Text>
        <Text variant="caption">No prior data</Text>
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
