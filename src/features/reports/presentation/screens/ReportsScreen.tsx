import React, {useMemo, useState} from 'react';
import {Alert, RefreshControl, ScrollView, View} from 'react-native';

import {DateRangeField, FilterChip} from '@components/filters';
import {
  Button,
  EmptyState,
  ErrorState,
  Screen,
  Skeleton,
  Text,
} from '@components/ui';
import {isReportEmpty} from '@features/reports/domain/entities';
import {
  exportReportCsv,
  exportReportPdf,
} from '@features/reports/domain/exportReport';
import {useReportSummary} from '@features/reports/presentation/hooks/useReportSummary';
import {useAuthStore} from '@store/auth.store';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';
import {toISODate} from '@utils/date';

type Preset = 'today' | 'week' | 'month' | 'quarter' | 'custom';

function presetRange(p: Exclude<Preset, 'custom'>): {from: string; to: string} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = toISODate(now);
  const day = 86_400_000;
  switch (p) {
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

const PRESETS: Array<{label: string; value: Exclude<Preset, 'custom'>}> = [
  {label: 'Today', value: 'today'},
  {label: 'Week', value: 'week'},
  {label: 'Month', value: 'month'},
  {label: 'Quarter', value: 'quarter'},
];

export function ReportsScreen(): React.JSX.Element {
  const businessName = useAuthStore(s => s.business?.businessName) ?? 'Your business';
  const [preset, setPreset] = useState<Preset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [exporting, setExporting] = useState<null | 'pdf' | 'csv'>(null);

  const applyPreset = (p: Exclude<Preset, 'custom'>) => {
    setPreset(p);
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };

  const {data, isLoading, isError, error, refetch, isRefetching} =
    useReportSummary(from, to);

  const onExport = async (kind: 'pdf' | 'csv') => {
    if (!data) return;
    setExporting(kind);
    try {
      if (kind === 'pdf') await exportReportPdf(data, businessName);
      else await exportReportCsv(data);
    } catch (e) {
      Alert.alert(
        'Could not export',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setExporting(null);
    }
  };

  const profitColor = useMemo(
    () => (data && data.profit >= 0 ? 'text-success' : 'text-danger'),
    [data],
  );

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
        <Text variant="title">Reports</Text>
        <Text variant="subtitle" className="mt-0.5">
          Profit &amp; loss and category breakdown
        </Text>

        {/* Range filters */}
        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          {PRESETS.map(p => (
            <FilterChip
              key={p.value}
              label={p.label}
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

        <View className="mt-6">
          {isLoading && !data ? (
            <Skeleton className="h-40 rounded-3xl" />
          ) : isError && !data ? (
            <ErrorState
              message={error?.message ?? 'Could not load the report.'}
              onRetry={refetch}
              retrying={isRefetching}
            />
          ) : data && isReportEmpty(data) ? (
            <EmptyState
              icon="📊"
              title="Nothing to report"
              message="No income or expenses in this range. Try a wider date range."
            />
          ) : data ? (
            <>
              {data.source === 'local' ? (
                <Text className="mb-3 text-xs font-medium text-amber-700">
                  Offline — figures computed on this device. Pull to refresh when
                  back online.
                </Text>
              ) : null}

              {/* P&L hero */}
              <View className="rounded-3xl bg-slate-900 px-5 py-6">
                <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Net profit
                </Text>
                <Text
                  className={`mt-1 text-4xl font-bold ${
                    data.profit >= 0 ? 'text-white' : 'text-red-300'
                  }`}
                  numberOfLines={1}
                  adjustsFontSizeToFit>
                  {formatINR(data.profit)}
                </Text>
                <View className="mt-5 flex-row" style={{gap: 12}}>
                  <View className="flex-1 rounded-2xl bg-white/5 p-3">
                    <Text className="text-[11px] uppercase text-slate-400">
                      Income
                    </Text>
                    <Text className="mt-1 text-base font-semibold text-green-300">
                      {formatINR(data.incomeTotal)}
                    </Text>
                  </View>
                  <View className="flex-1 rounded-2xl bg-white/5 p-3">
                    <Text className="text-[11px] uppercase text-slate-400">
                      Expense
                    </Text>
                    <Text className="mt-1 text-base font-semibold text-red-300">
                      {formatINR(data.expenseTotal)}
                    </Text>
                  </View>
                </View>
              </View>

              <CategoryTable
                title="Income by category"
                rows={data.incomeByCategory}
                tone="income"
              />
              <CategoryTable
                title="Expense by category"
                rows={data.expenseByCategory}
                tone="expense"
              />

              {/* Exports */}
              <View className="mt-8 flex-row" style={{gap: 12}}>
                <Button
                  title="⬇ PDF"
                  className="flex-1"
                  fullWidth={false}
                  loading={exporting === 'pdf'}
                  onPress={() => onExport('pdf')}
                />
                <Button
                  title="⬇ CSV (Excel)"
                  variant="secondary"
                  className="flex-1"
                  fullWidth={false}
                  loading={exporting === 'csv'}
                  onPress={() => onExport('csv')}
                />
              </View>
              <Text variant="caption" className="mt-2 text-center">
                Share to WhatsApp, email, or print.
              </Text>
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function CategoryTable({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: {category: string; amount: number; share: number}[];
  tone: 'income' | 'expense';
}): React.JSX.Element {
  return (
    <View className="mt-4 rounded-2xl border border-border bg-white p-4">
      <Text variant="label" className="mb-3">
        {title}
      </Text>
      {rows.length === 0 ? (
        <Text variant="caption">No entries in this range.</Text>
      ) : (
        <View style={{gap: 10}}>
          {rows.map(r => (
            <View key={r.category}>
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-slate-900">
                  {r.category}
                </Text>
                <Text
                  className={`text-sm font-semibold ${
                    tone === 'income' ? 'text-success' : 'text-danger'
                  }`}>
                  {formatINR(r.amount)}
                </Text>
              </View>
              {/* Share bar */}
              <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <View
                  className={tone === 'income' ? 'bg-success' : 'bg-danger'}
                  style={{
                    height: '100%',
                    width: `${Math.max(3, Math.round(r.share * 100))}%`,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
