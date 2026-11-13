import {personLabel} from '@utils/personLabel';
import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, RefreshControl, ScrollView, View} from 'react-native';

import {downloadAndShare} from '@api/download';
import {DateField} from '@components/form/DateField';
import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {activityQuery, teamRemote, type AccessEntry} from '@features/team/data/team.remote';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatTimestamp} from '@utils/date';

const TONE: Record<AccessEntry['action'], string> = {
  view: 'text-slate-700',
  export: 'text-sky-800',
  denied: 'text-red-700',
};

/** Owner: every ledger, report and export an accountant opened, newest first, in IST. */
export function AccountantActivityScreen({route}: AppScreenProps<'AccountantActivity'>): React.JSX.Element {
  const t = useT();
  const {userId, mobile} = route.params ?? {};
  // AC4: a date filter (IST days); empty = the latest 300. The log itself keeps every entry.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useQuery<AccessEntry[]>({queryKey: ['team', 'activity', userId ?? 'all', from, to],
    queryFn: () => teamRemote.activity(userId, from || undefined, to || undefined)});
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadAndShare(`/team/activity.xlsx${activityQuery(userId, from || undefined, to || undefined)}`,
        `accountant_activity_${from || 'start'}_${to || 'today'}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      Alert.alert(t('audit.exportFailed'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}>
        <Text variant="title">{t('audit.title')}</Text>
        <Text variant="subtitle" className="mt-1">
          {mobile ? t('audit.subtitleOne', {mobile}) : t('audit.subtitleAll')}
        </Text>
        {/* AC5: what this log can and can't see. */}
        <Text testID="audit-scope" variant="caption" className="mt-2">{t('audit.scopeNote')}</Text>

        <View className="mt-4 flex-row" style={{gap: 8}}>
          <View className="flex-1">
            <Text variant="caption">{t('common.from')}</Text>
            <DateField value={from} onChange={setFrom} />
          </View>
          <View className="flex-1">
            <Text variant="caption">{t('common.to')}</Text>
            <DateField value={to} onChange={setTo} />
          </View>
        </View>
        {from || to ? (
          <Button title={t('common.clearDates')} variant="ghost" fullWidth={false} className="mt-1 self-start"
            onPress={() => { setFrom(''); setTo(''); }} />
        ) : null}
        <Button testID="audit-export" title={t('audit.exportExcel')} variant="secondary" className="mt-3"
          loading={exporting} disabled={!q.data?.length} onPress={() => void exportExcel()} />

        <View className="mt-5" style={{gap: 8}}>
          {q.isLoading ? (
            <Skeleton className="h-16 rounded-2xl" />
          ) : q.isError ? (
            <ErrorState message={q.error?.message} onRetry={q.refetch} />
          ) : !q.data?.length ? (
            <EmptyState icon="🧾" title={t('audit.emptyTitle')} message={t('audit.emptyMsg')} />
          ) : (
            q.data.map((e: AccessEntry, i: number) => (
              <View key={`${e.at}-${i}`} testID="audit-row" className="rounded-xl border border-border bg-white p-3">
                <Text className={`text-sm font-semibold ${TONE[e.action]}`}>
                  {t(`audit.action.${e.action}` as TKey)} · {t(`audit.area.${e.area}` as TKey)}
                  {e.customer ? ` · ${e.customer}` : ''}
                </Text>
                <Text variant="caption">
                  {formatTimestamp(e.at)} IST · {personLabel(e.name, e.mobile)}
                </Text>
                {e.detail ? <Text testID="audit-detail" className="mt-1 text-xs text-slate-700">{e.detail}</Text> : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
