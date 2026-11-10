import {personLabel} from '@utils/personLabel';
import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {RefreshControl, ScrollView, View} from 'react-native';

import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {beatsRemote, type VisitRecord} from '@features/beats/data/beats.remote';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate, formatTimestamp} from '@utils/date';

/** Past visits for a shop, a salesperson or a beat, newest first. Staff see only their own. */
export function VisitHistoryScreen({route}: AppScreenProps<'VisitHistory'>): React.JSX.Element {
  const t = useT();
  const {customerId, userId, beatId, title} = route.params ?? {};
  const q = useQuery<VisitRecord[]>({
    queryKey: ['beats', 'visits', customerId ?? '', userId ?? '', beatId ?? ''],
    queryFn: () => beatsRemote.history({customerId, userId, beatId}),
  });

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} />}>
        <Text variant="title">{t('visits.title')}</Text>
        {title ? <Text variant="subtitle" className="mt-1">{title}</Text> : null}
        <View className="mt-5" style={{gap: 8}}>
          {q.isLoading ? (
            <Skeleton className="h-16 rounded-2xl" />
          ) : q.isError ? (
            <ErrorState onRetry={q.refetch} />
          ) : !q.data?.length ? (
            <EmptyState icon="🚶" title={t('visits.emptyTitle')} message={t('visits.emptyMsg')} />
          ) : (
            q.data.map((v: VisitRecord) => (
              <View key={v.id} testID="visit-row" className="rounded-xl border border-border bg-white p-3">
                <Text className="text-sm font-semibold">
                  {t(`beats.outcome.${v.outcome}` as TKey)} · {v.customerName}
                </Text>
                <Text variant="caption">
                  {formatTimestamp(v.visitedAt)} · {v.beatName}{v.userMobile || v.userName ? ` · ${personLabel(v.userName, v.userMobile)}` : ''}
                </Text>
                {v.reason ? <Text variant="caption">{v.reason}</Text> : null}
                {v.promiseDate ? (
                  <Text variant="caption">{t('visits.promise', {date: formatDisplayDate(v.promiseDate)})}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
