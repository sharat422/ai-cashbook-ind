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
  exportReportPdf,
  exportReportXlsx,
} from '@features/reports/domain/exportReport';
import {getReportTransactions} from '@features/reports/data/reportTransactions';
import {useReportSummary} from '@features/reports/presentation/hooks/useReportSummary';
import {useT, type TKey} from '@/i18n';
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

const PRESETS: Array<{labelKey: TKey; value: Exclude<Preset, 'custom'>}> = [
  {labelKey: 'khata.presetToday', value: 'today'},
  {labelKey: 'khata.presetWeek', value: 'week'},
  {labelKey: 'khata.presetMonth', value: 'month'},
  {labelKey: 'khata.presetQuarter', value: 'quarter'},
];

export function ReportsScreen(): React.JSX.Element {
  const t = useT();
  const businessName =
    useAuthStore(s => s.business?.businessName) ?? t('dashboard.yourBusiness');
  const [preset, setPreset] = useState<Preset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [exporting, setExporting] = useState<null | 'pdf' | 'xlsx'>(null);

  const applyPreset = (p: Exclude<Preset, 'custom'>) => {
    setPreset(p);
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };

  const {data, isLoading, isError, error, refetch, isRefetching} =
    useReportSummary(from, to);

  const onExport = async (kind: 'pdf' | 'xlsx') => {
    if (!data) return;
    setExporting(kind);
    try {
      // Both formats include the P&L summary + the full transaction list for
      // the selected range (line items fetched here, with an offline fallback).
      const {items} = await getReportTransactions(from, to);
      if (kind === 'pdf') await exportReportPdf(data, businessName, items);
      else await exportReportXlsx(data, items);
    } catch (e) {
      Alert.alert(
        t('reports.couldNotExport'),
        e instanceof Error ? e.message : t('ai.tryAgain'),
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
        <Text variant="title">{t('reports.title')}</Text>
        <Text variant="subtitle" className="mt-0.5">
          {t('reports.subtitle')}
        </Text>

        {/* Range filters */}
        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          {PRESETS.map(p => (
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

        <View className="mt-6">
          {isLoading && !data ? (
            <Skeleton className="h-40 rounded-3xl" />
          ) : isError && !data ? (
            <ErrorState
              message={error?.message ?? t('reports.loadError')}
              onRetry={refetch}
              retrying={isRefetching}
            />
          ) : data && isReportEmpty(data) ? (
            <EmptyState
              icon="📊"
              title={t('reports.emptyTitle')}
              message={t('reports.emptyMsg')}
            />
          ) : data ? (
            <>
              {data.source === 'local' ? (
                <Text className="mb-3 text-xs font-medium text-amber-700">
                  {t('reports.offlineNote')}
                </Text>
              ) : null}

              {/* P&L hero */}
              <View className="rounded-3xl bg-slate-900 px-5 py-6">
                <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {t('reports.netProfit')}
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
                      {t('reports.income')}
                    </Text>
                    <Text className="mt-1 text-base font-semibold text-green-300">
                      {formatINR(data.incomeTotal)}
                    </Text>
                  </View>
                  <View className="flex-1 rounded-2xl bg-white/5 p-3">
                    <Text className="text-[11px] uppercase text-slate-400">
                      {t('reports.expense')}
                    </Text>
                    <Text className="mt-1 text-base font-semibold text-red-300">
                      {formatINR(data.expenseTotal)}
                    </Text>
                  </View>
                </View>
              </View>

              <CategoryTable
                title={t('reports.incomeByCategory')}
                rows={data.incomeByCategory}
                tone="income"
              />
              <CategoryTable
                title={t('reports.expenseByCategory')}
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
                  title="⬇ Excel (.xlsx)"
                  variant="secondary"
                  className="flex-1"
                  fullWidth={false}
                  loading={exporting === 'xlsx'}
                  onPress={() => onExport('xlsx')}
                />
              </View>
              <Text variant="caption" className="mt-2 text-center">
                {t('reports.exportHint')}
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
  const t = useT();
  return (
    <View className="mt-4 rounded-2xl border border-border bg-white p-4">
      <Text variant="label" className="mb-3">
        {title}
      </Text>
      {rows.length === 0 ? (
        <Text variant="caption">{t('reports.noEntries')}</Text>
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
