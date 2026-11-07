import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {RefreshControl, ScrollView, View} from 'react-native';

import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {teamRemote, type AccessEntry} from '@features/team/data/team.remote';
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
  const q = useQuery<AccessEntry[]>({queryKey: ['team', 'activity', userId ?? 'all'], queryFn: () => teamRemote.activity(userId)});

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}>
        <Text variant="title">{t('audit.title')}</Text>
        <Text variant="subtitle" className="mt-1">
          {mobile ? t('audit.subtitleOne', {mobile}) : t('audit.subtitleAll')}
        </Text>

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
                  {formatTimestamp(e.at)} IST · +91 {e.mobile}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
