import React, {useMemo, useState} from 'react';
import {Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {DateRangeField, FilterChip} from '@components/filters';
import {
  EmptyState,
  ErrorState,
  Screen,
  Select,
  Skeleton,
  Text,
} from '@components/ui';
import {isKhataEmpty, type KhataFilters} from '@features/khata/domain/entities';
import {
  KhataStatCard,
  TopDefaultersList,
  TrendChart,
} from '@features/khata/presentation/components';
import {useKhataSummary} from '@features/khata/presentation/hooks';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {colors} from '@theme/colors';
import {toISODate} from '@utils/date';

type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'custom';

function presetRange(preset: Exclude<DatePreset, 'custom'>): {
  from: string;
  to: string;
} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = toISODate(now);
  const day = 86_400_000;
  switch (preset) {
    case 'today':
      return {from: today, to: today};
    case 'week':
      return {from: toISODate(new Date(now.getTime() - 6 * day)), to: today};
    case 'month':
      return {from: toISODate(new Date(y, m, 1)), to: today};
    case 'quarter':
      return {from: toISODate(new Date(y, Math.floor(m / 3) * 3, 1)), to: today};
  }
}

const DATE_PRESETS: Array<{labelKey: TKey; value: Exclude<DatePreset, 'custom'>}> = [
  {labelKey: 'khata.presetToday', value: 'today'},
  {labelKey: 'khata.presetWeek', value: 'week'},
  {labelKey: 'khata.presetMonth', value: 'month'},
  {labelKey: 'khata.presetQuarter', value: 'quarter'},
];

/** Executive Khata dashboard — receivables, payables, trend, defaulters. */
export function KhataDashboardScreen({
  navigation,
}: AppScreenProps<'KhataDashboard'>): React.JSX.Element {
  const t = useT();
  const businessName = useAuthStore(s => s.business?.businessName);
  const allBranches = t('khata.allBranches');
  const allBusinesses = t('khata.allBusinesses');
  const BRANCH_OPTIONS = useMemo(
    () => [allBranches, t('khata.mainBranch')],
    [allBranches, t],
  );
  const businessOptions = useMemo(
    () => [allBusinesses, businessName ?? t('dashboard.yourBusiness')],
    [allBusinesses, businessName, t],
  );

  const [preset, setPreset] = useState<DatePreset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [branch, setBranch] = useState(BRANCH_OPTIONS[0]);
  const [business, setBusiness] = useState(businessOptions[0]);

  const applyPreset = (p: Exclude<DatePreset, 'custom'>) => {
    setPreset(p);
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };

  const filters: KhataFilters = useMemo(
    () => ({
      from,
      to,
      branch: branch === allBranches ? 'all' : branch,
      business: business === allBusinesses ? 'all' : business,
    }),
    [from, to, branch, business, allBranches, allBusinesses],
  );

  const {data, isLoading, isError, error, refetch, isRefetching} =
    useKhataSummary(filters);

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
        <Text variant="title">{t('khata.title')}</Text>
        <Text variant="subtitle" className="mt-0.5">
          {businessName ?? t('dashboard.yourBusiness')}
        </Text>

        {/* AI insights banner */}
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('KhataInsights')}
          className="mt-4 flex-row items-center justify-between rounded-2xl bg-slate-900 px-4 py-3">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-bold text-white">
              {t('khata.aiInsights')}
            </Text>
            <Text className="text-xs text-slate-400">
              {t('khata.aiInsightsSub')}
            </Text>
          </View>
          <Text className="text-base font-semibold text-white">→</Text>
        </Pressable>

        {/* Customer intelligence banner */}
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('CustomerInsights')}
          className="mt-3 flex-row items-center justify-between rounded-2xl border border-border bg-white px-4 py-3">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-bold text-slate-900">
              {t('khata.custIntel')}
            </Text>
            <Text className="text-xs text-muted">
              {t('khata.custIntelSub')}
            </Text>
          </View>
          <Text className="text-base font-semibold text-primary">→</Text>
        </Pressable>

        {/* Filters */}
        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          {DATE_PRESETS.map(p => (
            <FilterChip
              key={p.value}
              label={t(p.labelKey)}
              selected={preset === p.value}
              onPress={() => applyPreset(p.value)}
            />
          ))}
        </View>
        <View className="mt-3">
          <DateRangeField
            from={from}
            to={to}
            onChange={({from: f, to: t}) => {
              setPreset('custom');
              if (f) setFrom(f);
              if (t) setTo(t);
            }}
          />
        </View>
        <View className="mt-3 flex-row" style={{gap: 12}}>
          <View className="flex-1">
            <Select
              label={t('khata.branch')}
              options={BRANCH_OPTIONS}
              value={branch}
              onSelect={setBranch}
            />
          </View>
          <View className="flex-1">
            <Select
              label={t('khata.business')}
              options={businessOptions}
              value={business}
              onSelect={setBusiness}
            />
          </View>
        </View>

        {/* Body */}
        <View className="mt-6">
          {isLoading && !data ? (
            <SkeletonBody />
          ) : isError && !data ? (
            <ErrorState
              message={error?.message ?? t('khata.loadError')}
              onRetry={refetch}
              retrying={isRefetching}
            />
          ) : data && isKhataEmpty(data) ? (
            <EmptyState
              icon="📒"
              title={t('khata.emptyTitle')}
              message={t('khata.emptyMsg')}
            />
          ) : data ? (
            <>
              {data.source === 'local' ? (
                <Text className="mb-3 text-xs font-medium text-amber-700">
                  {t('khata.offlineNote')}
                </Text>
              ) : null}

              {/* Receivable / Payable */}
              <View className="flex-row" style={{gap: 12}}>
                <KhataStatCard
                  label={t('khata.totalReceivable')}
                  amount={data.totalReceivable}
                  icon="📥"
                  accent="receivable"
                  hero
                />
                <KhataStatCard
                  label={t('khata.totalPayable')}
                  amount={data.totalPayable}
                  icon="📤"
                  accent="payable"
                  hero
                />
              </View>

              {/* Overdue / Today's collections */}
              <View className="mt-3 flex-row" style={{gap: 12}}>
                <KhataStatCard
                  label={t('khata.overdueAmount')}
                  amount={data.overdueAmount}
                  icon="⏰"
                  accent="overdue"
                />
                <KhataStatCard
                  label={t('khata.todayCollections')}
                  amount={data.todayCollections}
                  icon="💸"
                  accent="collections"
                />
              </View>

              {/* Payment trend */}
              <View className="mt-4 rounded-2xl border border-border bg-white p-4">
                <Text variant="label" className="mb-2">
                  {t('khata.paymentTrend')}
                </Text>
                <TrendChart data={data.trend} />
              </View>

              {/* Top defaulters */}
              <View className="mt-4 rounded-2xl border border-border bg-white p-4">
                <Text variant="label" className="mb-3">
                  {t('khata.topDefaulters')}
                </Text>
                <TopDefaultersList defaulters={data.topDefaulters} />
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function SkeletonBody(): React.JSX.Element {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="flex-row" style={{gap: 12}}>
        <Skeleton className="h-28 flex-1 rounded-2xl" />
        <Skeleton className="h-28 flex-1 rounded-2xl" />
      </View>
      <View className="mt-3 flex-row" style={{gap: 12}}>
        <Skeleton className="h-24 flex-1 rounded-2xl" />
        <Skeleton className="h-24 flex-1 rounded-2xl" />
      </View>
      <Skeleton className="mt-4 h-48 rounded-2xl" />
      <Skeleton className="mt-4 h-40 rounded-2xl" />
    </View>
  );
}
