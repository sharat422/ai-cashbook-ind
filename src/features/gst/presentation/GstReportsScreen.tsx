import {useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, Share, View} from 'react-native';

import {FormField, TextField} from '@components/form';
import {Button, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {gstRemote, type CaTestRecord, type GstReport} from '@features/gst/data/gst.remote';
import {caTestVerdict} from '@features/gst/domain/gst';
import {useCaTestStore} from '@features/gst/presentation/caTest.store';
import {formatMoney} from '@features/reconciliation/domain/money';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {formatDisplayDate} from '@utils/date';

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
  {report: 'itc-review.xlsx', label: 'gst.downloadItcReview'},
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
  // Saved results: the record of each CA test, shared from what was saved.
  const {can} = usePermissions();
  const canSave = can(PERMISSIONS.ENTRY_EDIT);
  const queryClient = useQueryClient();
  const saved = useQuery({queryKey: ['ca-tests', businessId], queryFn: gstRemote.caTests});
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSaveNow = verdict !== 'pending' && !!result.caName?.trim();
  const saveResult = async () => {
    setSaving(true);
    try {
      await gstRemote.saveCaTest({
        testedMonth: month, caName: result.caName!.trim(), tallyVersion: result.tallyVersion?.trim() || null,
        offlineToolVersion: null, recordsExported: exported, recordsImported: result.imported ?? null,
        fieldsRetyped: result.retyped ?? 0, offlineToolErrors: result.offlineErrors ?? 0,
        discrepancyNote: result.note?.trim() || null,
      });
      await queryClient.invalidateQueries({queryKey: ['ca-tests', businessId]});
    } catch (err) {
      Alert.alert(t('form.couldNotSave'), err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const shareRecord = (r: CaTestRecord) => {
    const v = caTestVerdict(r.recordsExported ?? 0, r.recordsImported ?? undefined, r.fieldsRetyped);
    return Share.share({
      message: t('gst.caShareSaved', {
        month: r.testedMonth, ca: r.caName, exported: r.recordsExported ?? '—', imported: r.recordsImported ?? '—',
        retyped: r.fieldsRetyped, percent: `${Math.round(v.retypedShare * 1000) / 10}%`, errors: r.offlineToolErrors,
        verdict: t(`gst.verdict.${v.verdict}`), date: formatDisplayDate(r.testedAt),
      }) + (r.discrepancyNote ? `\n${r.discrepancyNote}` : ''),
    });
  };

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
              testID="ca-imported"
              value={result.imported === undefined ? '' : String(result.imported)}
              onChangeText={v => setResult(key, {imported: toCount(v)})}
              keyboardType="number-pad"
              placeholder="0"
            />
          </FormField>
          <FormField label={t('gst.caRetyped')} hint={t('gst.caRetypedHint')}>
            <TextField
              testID="ca-retyped"
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
          {canSave ? (
            <>
              <FormField label={t('gst.caName')} required>
                <TextField testID="ca-name" value={result.caName ?? ''} maxLength={120}
                  onChangeText={v => setResult(key, {caName: v})} />
              </FormField>
              <FormField label={t('gst.caTallyVersion')} hint={t('common.optional')}>
                <TextField testID="ca-tally" value={result.tallyVersion ?? ''} maxLength={60}
                  onChangeText={v => setResult(key, {tallyVersion: v})} />
              </FormField>
              <FormField label={t('gst.caOfflineErrors')}>
                <TextField testID="ca-errors" keyboardType="number-pad" placeholder="0"
                  value={result.offlineErrors === undefined ? '' : String(result.offlineErrors)}
                  onChangeText={v => setResult(key, {offlineErrors: toCount(v)})} />
              </FormField>
              <FormField label={t('gst.caNote')} hint={t('gst.caNoteHint')}>
                <TextField testID="ca-note" value={result.note ?? ''} multiline maxLength={5000}
                  onChangeText={v => setResult(key, {note: v})} />
              </FormField>
              <Button testID="ca-save" title={t('gst.caSave')} loading={saving} disabled={!canSaveNow || saving}
                onPress={saveResult} />
            </>
          ) : null}
        </View>

        <Text variant="label" className="mt-8">{t('gst.caPast')}</Text>
        {(saved.data ?? []).length === 0 ? (
          <Text variant="caption">{t('gst.caNoneSaved')}</Text>
        ) : (
          (saved.data ?? []).map((r: CaTestRecord) => (
            <Pressable key={r.id} testID={`ca-test-${r.id}`} onPress={() => setOpenNote(o => (o === r.id ? null : r.id))}
              className="mt-3 rounded-2xl border border-border bg-white p-4" style={{gap: 4}}>
              <Text className="text-sm font-semibold">{r.testedMonth} · {r.caName}</Text>
              <Text variant="caption">
                {t('gst.caPastLine', {retyped: r.fieldsRetyped, errors: r.offlineToolErrors,
                  date: formatDisplayDate(r.testedAt)})}
              </Text>
              {r.discrepancyNote ? (
                <Text variant="caption" numberOfLines={openNote === r.id ? undefined : 1}>{r.discrepancyNote}</Text>
              ) : null}
              <Button testID={`ca-share-${r.id}`} title={t('gst.caShare')} variant="ghost" onPress={() => shareRecord(r)} />
            </Pressable>
          ))
        )}
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
