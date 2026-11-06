import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, Share, View} from 'react-native';

import {FormField, TextField} from '@components/form';
import {Button, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {gstRemote, type GstReport} from '@features/gst/data/gst.remote';
import {caTestVerdict} from '@features/gst/domain/gst';
import {useCaTestStore} from '@features/gst/presentation/caTest.store';
import {formatMoney} from '@features/reconciliation/domain/money';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';

const pad = (n: number) => String(n).padStart(2, '0');

function monthRange(ym: string): {from: string; to: string} {
  const [y, m] = ym.split('-').map(Number);
  return {from: `${ym}-01`, to: `${ym}-${pad(new Date(y, m, 0).getDate())}`};
}

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const REPORTS = [
  {report: 'gstr1.xlsx', label: 'gst.downloadGstr1'},
  {report: 'gstr3b-summary.xlsx', label: 'gst.downloadGstr3b'},
  {report: 'tally-export.xlsx', label: 'gst.downloadTallyXlsx'},
  {report: 'tally-export.csv', label: 'gst.downloadTallyCsv'},
] as const satisfies readonly {report: GstReport; label: string}[];

/**
 * Monthly GST-ready files for the CA (GSTR-1-ready workbook, GSTR-3B summary,
 * Tally import sheet) and the CA test checklist. Working files only — the app
 * does not file returns or create e-invoices.
 */
export function GstReportsScreen(_: AppScreenProps<'GstReports'>): React.JSX.Element {
  const t = useT();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const {from, to} = monthRange(month);
  const businessId = useAuthStore(s => s.business?.id ?? '');
  const summary = useQuery({
    queryKey: ['gst-summary', businessId, from, to],
    queryFn: () => gstRemote.summary(from, to),
  });
  const [busy, setBusy] = useState<GstReport | null>(null);

  const key = `${businessId}:${month}`;
  const result = useCaTestStore(s => s.results[key]) ?? {};
  const setResult = useCaTestStore(s => s.setResult);
  const exported = summary.data?.invoices ?? 0;
  const {verdict, retypedShare} = caTestVerdict(exported, result.imported, result.retyped);

  const download = async (report: GstReport) => {
    setBusy(report);
    try {
      await gstRemote.download(report, from, to);
    } catch (err) {
      Alert.alert(t('gst.downloadFailed'), err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const toCount = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v.replace(/\D/g, '')));
  const percent = `${Math.round(retypedShare * 1000) / 10}%`;
  const shareResult = () =>
    Share.share({
      message: t('gst.caShareText', {
        month,
        exported,
        imported: result.imported ?? '—',
        retyped: result.retyped ?? '—',
        percent,
        verdict: t(`gst.verdict.${verdict}`),
      }),
    });

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={() => summary.refetch()} />}>
        <Text variant="title">{t('gst.reportsTitle')}</Text>
        <Text variant="caption" className="mt-1">
          {t('gst.reportsSubtitle')}
        </Text>

        <View className="mt-5 flex-row items-center justify-between rounded-2xl bg-white p-3">
          <Pressable accessibilityLabel={t('gst.prevMonth')} onPress={() => setMonth(shiftMonth(month, -1))} className="px-3 py-1">
            <Text className="text-lg font-bold text-primary">‹</Text>
          </Pressable>
          <Text className="text-base font-semibold text-slate-900">{month}</Text>
          <Pressable accessibilityLabel={t('gst.nextMonth')} onPress={() => setMonth(shiftMonth(month, 1))} className="px-3 py-1">
            <Text className="text-lg font-bold text-primary">›</Text>
          </Pressable>
        </View>

        {summary.isLoading ? (
          <Skeleton className="mt-4 h-32 w-full" />
        ) : summary.isError ? (
          <ErrorState onRetry={() => summary.refetch()} retrying={summary.isFetching} />
        ) : summary.data ? (
          <View className="mt-4 rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
            <Row label={t('gst.invoiceCount')} value={String(summary.data.invoices)} bold />
            <Row label={t('gst.taxableValue')} value={formatMoney(summary.data.taxableValue)} />
            <Row label={t('gst.cgst')} value={formatMoney(summary.data.cgst)} />
            <Row label={t('gst.sgst')} value={formatMoney(summary.data.sgst)} />
            <Row label={t('gst.igst')} value={formatMoney(summary.data.igst)} />
            <Row label={t('gst.invoiceTotal')} value={formatMoney(summary.data.total)} bold />
            {summary.data.invoices === 0 ? <Text variant="caption">{t('gst.noInvoices')}</Text> : null}
            {summary.data.rateChanges > 0 ? (
              <Text variant="caption">{t('gst.rateChanges', {count: summary.data.rateChanges})}</Text>
            ) : null}
          </View>
        ) : null}

        <View className="mt-4" style={{gap: 8}}>
          {REPORTS.map(r => (
            <Button
              key={r.report}
              title={t(r.label)}
              variant="secondary"
              loading={busy === r.report}
              disabled={busy !== null}
              onPress={() => download(r.report)}
            />
          ))}
        </View>

        <Text variant="label" className="mt-8">
          {t('gst.caTestTitle')}
        </Text>
        <Text variant="caption">{t('gst.caTestHint')}</Text>
        <View className="mt-3 rounded-2xl border border-border bg-white p-4" style={{gap: 14}}>
          <Row label={t('gst.caExported')} value={String(exported)} bold />
          <FormField label={t('gst.caImported')}>
            <TextField
              value={result.imported === undefined ? '' : String(result.imported)}
              onChangeText={v => setResult(key, {imported: toCount(v)})}
              keyboardType="number-pad"
              placeholder="0"
            />
          </FormField>
          <FormField label={t('gst.caRetyped')} hint={t('gst.caRetypedHint')}>
            <TextField
              value={result.retyped === undefined ? '' : String(result.retyped)}
              onChangeText={v => setResult(key, {retyped: toCount(v)})}
              keyboardType="number-pad"
              placeholder="0"
            />
          </FormField>
          <View
            testID="ca-verdict"
            className={`rounded-xl p-3 ${
              verdict === 'pass' ? 'bg-green-50' : verdict === 'fail' ? 'bg-red-50' : 'bg-amber-50'
            }`}>
            <Text className="text-sm font-bold text-slate-900">{t(`gst.verdict.${verdict}`)}</Text>
            {verdict !== 'pending' ? (
              <Text variant="caption">{t('gst.caRetypedShare', {percent})}</Text>
            ) : null}
          </View>
          {verdict !== 'pending' ? (
            <Button title={t('gst.caShare')} variant="secondary" onPress={shareResult} />
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row({label, value, bold}: {label: string; value: string; bold?: boolean}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={`text-sm ${bold ? 'font-bold' : ''} text-slate-900`}>{label}</Text>
      <Text className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} text-slate-900`}>{value}</Text>
    </View>
  );
}
