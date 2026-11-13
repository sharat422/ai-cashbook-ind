import React from 'react';
import {FlatList, Pressable, RefreshControl, View} from 'react-native';

import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {Scheme} from '@features/schemes/data/schemes.remote';
import {describeScheme, schemeStatus} from '@features/schemes/domain/schemeText';
import {useSchemes} from '@features/schemes/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate, todayIST} from '@utils/date';

const STATUS_STYLE = {
  live: 'bg-green-100 text-green-800',
  upcoming: 'bg-amber-100 text-amber-800',
  expired: 'bg-slate-100 text-slate-600',
  off: 'bg-slate-100 text-slate-600',
} as const;

/** Trade schemes in priority order (1 first). Applied automatically at billing. */
export function SchemesScreen({navigation}: AppScreenProps<'Schemes'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const canEdit = can(PERMISSIONS.SETTINGS_MANAGE);
  const schemes = useSchemes();
  const today = todayIST();
  const list: Scheme[] = schemes.data ?? [];

  if (schemes.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-24 w-full" />
      </Screen>
    );
  }
  if (schemes.isError) {
    return (
      <Screen>
        <ErrorState onRetry={() => schemes.refetch()} retrying={schemes.isFetching} />
      </Screen>
    );
  }
  return (
    <Screen scroll={false}>
      <FlatList
        data={list}
        keyExtractor={s => s.id}
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40, gap: 12}}
        refreshControl={<RefreshControl refreshing={schemes.isRefetching} onRefresh={() => schemes.refetch()} />}
        ListHeaderComponent={
          <View style={{gap: 10}}>
            <Text variant="title">{t('schemes.title')}</Text>
            <Text variant="caption">{t('schemes.subtitle')}</Text>
            <View className="flex-row" style={{gap: 8}}>
              {canEdit ? (
                <Button title={t('schemes.add')} className="flex-1" onPress={() => navigation.navigate('SchemeForm', {})} />
              ) : null}
              <Button title={t('schemes.report')} variant="secondary" className="flex-1"
                onPress={() => navigation.navigate('SchemeReport', {})} />
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="🎁" title={t('schemes.emptyTitle')} message={t('schemes.emptyMsg')} />}
        renderItem={({item: s}: {item: Scheme}) => {
          const status = schemeStatus(s, today);
          return (
            <Pressable
              disabled={!canEdit}
              onPress={() => navigation.navigate('SchemeForm', {scheme: s})}
              className="rounded-2xl border border-border bg-white p-4">
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 text-base font-bold text-slate-900">
                  {s.priority}. {s.name}
                </Text>
                <Text className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[status]}`}>
                  {t(`schemes.status.${status}`)}
                </Text>
              </View>
              <Text className="mt-1 text-sm text-slate-900">{describeScheme(s, () => s.freeItemName || '—')}</Text>
              <Text variant="caption" className="mt-1">
                {(s.itemNames ?? []).map(n => n || '—').join(', ')} · {formatDisplayDate(s.validFrom)} – {formatDisplayDate(s.validTo)}
              </Text>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
