import React from 'react';
import {Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {
  Aging,
  CustomerInsights,
  CustomerRow,
} from '@features/customer-intel/data/customerIntel.remote';
import {
  useCustomerAging,
  useCustomerInsights,
} from '@features/customer-intel/presentation/hooks';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

const AGING_ROWS: Array<{key: keyof Aging['buckets']; label: string; tint: string}> = [
  {key: 'current', label: 'Current', tint: 'bg-success'},
  {key: 'd1_30', label: '1–30 days', tint: 'bg-amber-400'},
  {key: 'd31_60', label: '31–60 days', tint: 'bg-amber-500'},
  {key: 'd61_90', label: '61–90 days', tint: 'bg-orange-500'},
  {key: 'd90_plus', label: '90+ days', tint: 'bg-danger'},
];

export function CustomerInsightsScreen({
  navigation,
}: AppScreenProps<'CustomerInsights'>): React.JSX.Element {
  const aging = useCustomerAging();
  const insights = useCustomerInsights();

  const refreshing = aging.isRefetching || insights.isRefetching;
  const refetch = () => {
    aging.refetch();
    insights.refetch();
  };

  const goto = (customerId: string, name: string) =>
    // Deep-link into the customer list filtered by name (tap-through).
    navigation.navigate('Customers', {search: name});

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }>
        <Text variant="title">Customer intelligence</Text>
        <Text variant="subtitle" className="mt-0.5">
          Aging, risk, and who to chase
        </Text>

        {/* Aging */}
        <View className="mt-5 rounded-2xl border border-border bg-white p-4">
          <Text variant="label" className="mb-3">
            Receivables aging
          </Text>
          {aging.isLoading && !aging.data ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : aging.isError && !aging.data ? (
            <ErrorState
              message={aging.error?.message ?? 'Could not load aging.'}
              onRetry={aging.refetch}
            />
          ) : aging.data ? (
            <AgingBars aging={aging.data} />
          ) : null}
        </View>

        {/* Smart lists */}
        {insights.isLoading && !insights.data ? (
          <Skeleton className="mt-4 h-64 rounded-2xl" />
        ) : insights.isError && !insights.data ? (
          <View className="mt-4">
            <ErrorState
              message={insights.error?.message ?? 'Could not load insights.'}
              onRetry={insights.refetch}
            />
          </View>
        ) : insights.data ? (
          <Lists data={insights.data} onTap={goto} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function AgingBars({aging}: {aging: Aging}): React.JSX.Element {
  const max = Math.max(
    aging.buckets.current,
    aging.buckets.d1_30,
    aging.buckets.d31_60,
    aging.buckets.d61_90,
    aging.buckets.d90_plus,
    1,
  );
  if (aging.total <= 0) {
    return <Text variant="caption">No outstanding receivables.</Text>;
  }
  return (
    <View style={{gap: 12}}>
      {AGING_ROWS.map(r => {
        const value = aging.buckets[r.key];
        return (
          <View key={r.key}>
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-slate-700">{r.label}</Text>
              <Text className="text-sm font-semibold text-slate-900">
                {formatINR(value)}
              </Text>
            </View>
            <View className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <View
                className={`h-full rounded-full ${r.tint}`}
                style={{width: `${Math.max(2, Math.round((value / max) * 100))}%`}}
              />
            </View>
          </View>
        );
      })}
      <View className="mt-1 flex-row items-center justify-between border-t border-border pt-2">
        <Text className="text-sm font-semibold text-slate-900">Total due</Text>
        <Text className="text-sm font-bold text-slate-900">
          {formatINR(aging.total)}
        </Text>
      </View>
    </View>
  );
}

function Lists({
  data,
  onTap,
}: {
  data: CustomerInsights;
  onTap: (id: string, name: string) => void;
}): React.JSX.Element {
  return (
    <View style={{gap: 12}} className="mt-4">
      <Section
        icon="💰"
        title="Who owes me the most?"
        rows={data.topDebtors.map(r => ({
          id: r.customerId,
          name: r.name,
          right: formatINR(r.outstanding),
        }))}
        onTap={onTap}
      />
      <Section
        icon="⏰"
        title="Who is late?"
        subtitle={`${data.overdueCount} overdue`}
        rows={data.overdue.map(r => ({
          id: r.customerId,
          name: r.name,
          right: `${formatINR(r.outstanding)} · ${r.daysOverdue}d`,
        }))}
        onTap={onTap}
      />
      <Section
        icon="✅"
        title="Who paid this month?"
        rows={data.paidThisMonth.map(r => ({
          id: r.customerId,
          name: r.name,
          right: formatINR(r.amount),
        }))}
        onTap={onTap}
      />
      <Section
        icon="🛌"
        title="Who hasn’t purchased recently?"
        rows={data.dormant.map(r => ({
          id: r.customerId,
          name: r.name,
          right: `${r.daysSince}d ago`,
        }))}
        onTap={onTap}
      />
      <Section
        icon="🚨"
        title="Which customers are high risk?"
        rows={data.highRisk.map(r => ({
          id: r.customerId,
          name: r.name,
          right: `Risk ${r.score}`,
        }))}
        onTap={onTap}
      />
    </View>
  );
}

function Section({
  icon,
  title,
  subtitle,
  rows,
  onTap,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  rows: Array<{id: string; name: string; right: string}>;
  onTap: (id: string, name: string) => void;
}): React.JSX.Element {
  return (
    <View className="rounded-2xl border border-border bg-white p-4">
      <View className="mb-2 flex-row items-center justify-between">
        <Text variant="label">
          {icon} {title}
        </Text>
        {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
      </View>
      {rows.length === 0 ? (
        <Text variant="caption">None right now.</Text>
      ) : (
        <View style={{gap: 6}}>
          {rows.slice(0, 5).map(r => (
            <Pressable
              key={r.id}
              onPress={() => onTap(r.id, r.name)}
              className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <Text className="flex-1 pr-3 font-medium text-slate-900" numberOfLines={1}>
                {r.name}
              </Text>
              <Text className="text-sm font-semibold text-slate-900">
                {r.right}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
