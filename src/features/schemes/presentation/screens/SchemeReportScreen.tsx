import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {formatMoney} from '@features/reconciliation/domain/money';
import {schemesRemote, type SchemeApplication, type SchemeReport} from '@features/schemes/data/schemes.remote';
import {SCHEMES_KEY, useSchemeLog, useSchemeReport} from '@features/schemes/presentation/hooks';
import {formatQty} from '@features/stock/domain/qty';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate, nowIST} from '@utils/date';

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

/**
 * Scheme summary by scheme and SKU for a month, and the scheme log (every
 * scheme considered on each bill, applied or not). From a retailer's profile
 * it opens on that retailer's log.
 */
export function SchemeReportScreen({navigation, route}: AppScreenProps<'SchemeReport'>): React.JSX.Element {
  const t = useT();
  const {customerId, customerName} = route.params ?? {};
  const {can} = usePermissions();
  const canReport = can(PERMISSIONS.REPORTS_VIEW);
  const now = nowIST(); // India's today, whatever the phone's time zone
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [tab, setTab] = useState<'summary' | 'log'>(customerId || !canReport ? 'log' : 'summary');
  const {from, to} = monthRange(month);
  const report = useSchemeReport(from, to);
  const log = useSchemeLog(from, to, customerId);
  const active = tab === 'summary' ? report : log;
  const data: SchemeReport | undefined = report.data;
  const rows: SchemeApplication[] = log.data ?? [];
  // File a claim (owner): one per scheme given away this month, its value across SKUs.
  const canClaim = can(PERMISSIONS.SETTINGS_MANAGE);
  const qc = useQueryClient();
  const [filing, setFiling] = useState<string | null>(null);
  const toClaim = Object.values((data?.rows ?? []).reduce<Record<string, {id: string; name: string; value: number}>>(
    (acc, r) => {
      const s = (acc[r.schemeId] ??= {id: r.schemeId, name: r.schemeName, value: 0});
      s.value += Number(r.value);
      return acc;
    }, {})).filter(s => s.value > 0);
  const fileClaim = (s: {id: string; name: string; value: number}) =>
    Alert.alert(t('claims.fileTitle', {scheme: s.name}), t('claims.fileMsg', {
      value: formatMoney(s.value.toFixed(2)), from: formatDisplayDate(from), to: formatDisplayDate(to)}), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('claims.file'), onPress: async () => {
        setFiling(s.id);
        try {
          await schemesRemote.fileClaim(s.id, from, to);
          await qc.invalidateQueries({queryKey: [SCHEMES_KEY, 'claims']});
          navigation.navigate('SchemeClaims');
        } catch (e) {
          Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
        } finally {
          setFiling(null);
        }
      }},
    ]);

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={active.isRefetching} onRefresh={() => active.refetch()} />}>
        <Text variant="title">{customerName ? t('schemes.logFor', {name: customerName}) : t('schemes.report')}</Text>
        <View className="mt-4 flex-row items-center justify-between rounded-2xl bg-white p-3">
          <Pressable accessibilityLabel={t('gst.prevMonth')} onPress={() => setMonth(shiftMonth(month, -1))} className="px-3 py-1">
            <Text className="text-lg font-bold text-primary">‹</Text>
          </Pressable>
          <Text className="text-base font-semibold text-slate-900">{month}</Text>
          <Pressable accessibilityLabel={t('gst.nextMonth')} onPress={() => setMonth(shiftMonth(month, 1))} className="px-3 py-1">
            <Text className="text-lg font-bold text-primary">›</Text>
          </Pressable>
        </View>
        {!customerId && canReport ? (
          <View className="mt-3 flex-row" style={{gap: 8}}>
            <FilterChip label={t('schemes.summaryTab')} selected={tab === 'summary'} onPress={() => setTab('summary')} />
            <FilterChip label={t('schemes.logTab')} selected={tab === 'log'} onPress={() => setTab('log')} />
            <FilterChip testID="open-claims" label={t('claims.title')} onPress={() => navigation.navigate('SchemeClaims')} />
          </View>
        ) : null}

        {active.isLoading ? (
          <Skeleton className="mt-4 h-32 w-full" />
        ) : active.isError ? (
          <ErrorState onRetry={() => active.refetch()} retrying={active.isFetching} />
        ) : tab === 'summary' && data ? (
          <>
            <View testID="scheme-totals" className="mt-4 rounded-2xl bg-slate-900 p-4" style={{gap: 6}}>
              <Line light label={t('schemes.totalValue')} value={formatMoney(data.totalValue)} bold />
              <Line light label={t('schemes.totalDiscount')} value={formatMoney(data.totalDiscount)} />
              <Line light label={t('schemes.totalFree')} value={formatQty(data.totalFreeQty)} />
            </View>
            {canClaim && toClaim.length > 0 ? (
              <View testID="scheme-claims" className="mt-3 rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
                <Text variant="label">{t('claims.fileHeading')}</Text>
                {toClaim.map(s => (
                  <View key={s.id} className="flex-row items-center justify-between" style={{gap: 8}}>
                    <Text className="flex-1 text-sm">{s.name} · {formatMoney(s.value.toFixed(2))}</Text>
                    <Button testID={`claim-file-${s.id}`} title={t('claims.file')} variant="secondary" fullWidth={false}
                      loading={filing === s.id} disabled={filing !== null} onPress={() => fileClaim(s)} />
                  </View>
                ))}
              </View>
            ) : null}
            {data.rows.length === 0 ? <EmptyState icon="🎁" title={t('schemes.noneApplied')} /> : null}
            {data.rows.map(r => (
              <View key={`${r.schemeId}-${r.itemId}`} className="mt-3 rounded-2xl border border-border bg-white p-4" style={{gap: 4}}>
                <Text className="text-sm font-bold text-slate-900">{r.schemeName} · {r.itemName}</Text>
                <Line label={t('schemes.bills')} value={String(r.bills)} />
                <Line label={t('schemes.qtySold')} value={formatQty(r.quantity)} />
                <Line label={t('schemes.freeGiven')} value={formatQty(r.freeQty)} />
                <Line label={t('schemes.discountGiven')} value={formatMoney(r.discount)} />
                <Line label={t('schemes.value')} value={formatMoney(r.value)} bold />
              </View>
            ))}
          </>
        ) : (
          <>
            {rows.length === 0 ? <EmptyState icon="🧾" title={t('schemes.logEmpty')} /> : null}
            {rows.map(a => (
              <View key={a.id} className={`mt-3 rounded-2xl p-3 ${a.status === 'applied' ? 'bg-white' : 'bg-slate-50'}`}>
                <View className="flex-row justify-between">
                  <Text className="flex-1 text-sm font-semibold text-slate-900">
                    {a.status === 'applied' ? '🎁' : '⏸'} {a.schemeName} · {a.itemName}
                  </Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {a.status === 'applied' ? formatMoney(a.value) : t('schemes.notApplied')}
                  </Text>
                </View>
                <Text variant="caption">
                  {a.billNumber} · {formatDisplayDate(a.date)} · {t('schemes.qty', {qty: formatQty(a.quantity)})}
                  {Number(a.freeQty) > 0 ? ` · ${t('bill.freeGoods', {qty: formatQty(a.freeQty), item: a.freeItemName ?? ''})}` : ''}
                  {a.groupNote ? ` · ${a.groupNote}` : ''}
                  {Number(a.discount) > 0 ? ` · ${t('bill.discount', {amount: formatMoney(a.discount)})}` : ''}
                </Text>
                {a.reason ? <Text variant="caption">{a.reason}</Text> : null}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Line({label, value, bold, light}: {label: string; value: string; bold?: boolean; light?: boolean}) {
  const color = light ? 'text-white' : 'text-slate-900';
  return (
    <View className="flex-row justify-between">
      <Text className={`text-sm ${bold ? 'font-bold' : ''} ${color}`}>{label}</Text>
      <Text className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} ${color}`}>{value}</Text>
    </View>
  );
}
