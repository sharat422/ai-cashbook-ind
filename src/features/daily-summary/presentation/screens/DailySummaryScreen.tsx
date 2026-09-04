import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
} from '@components/ui';
import {isSummaryEmpty} from '@features/daily-summary/domain/entities';
import {
  ProfitHeroCard,
  TopCategoriesList,
} from '@features/daily-summary/presentation/components';
import {sendDailySummaryNow} from '@features/daily-summary/presentation/dispatch';
import {useDailySummary} from '@features/daily-summary/presentation/hooks';
import {useSummarySettingsStore} from '@features/daily-summary/presentation/store/summarySettings.store';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

const pad = (n: number) => `${n}`.padStart(2, '0');

/**
 * Daily Summary Engine UI: income / expense / profit + top expense categories,
 * with the notification schedule controls and a manual "send now".
 */
export function DailySummaryScreen({
  navigation,
}: AppScreenProps<'DailySummary'>): React.JSX.Element {
  const t = useT();
  const today = toISODate(new Date());
  const {data, isLoading, isError, error, refetch, isRefetching} =
    useDailySummary(today);
  const ENABLED_OPTIONS = [
    {label: t('common.on'), value: true},
    {label: t('common.off'), value: false},
  ];

  const enabled = useSummarySettingsStore(state => state.enabled);
  const hour = useSummarySettingsStore(state => state.hour);
  const minute = useSummarySettingsStore(state => state.minute);
  const setEnabled = useSummarySettingsStore(state => state.setEnabled);
  const setTime = useSummarySettingsStore(state => state.setTime);

  const [sending, setSending] = useState(false);

  const onSendNow = async () => {
    setSending(true);
    try {
      const delivered = await sendDailySummaryNow();
      Alert.alert(
        t('daily.sentTitle'),
        delivered.length > 0
          ? t('daily.sentMsg', {channels: delivered.join(', ')})
          : t('daily.sentNone'),
      );
    } catch (e) {
      Alert.alert(
        t('daily.couldNotSend'),
        e instanceof Error ? e.message : t('ai.tryAgain'),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">{t('daily.title')}</Text>
        <Text variant="subtitle" className="mt-2">
          {t('daily.subtitle')}
        </Text>

        {/* Summary */}
        <View className="mt-6">
          {isLoading && !data ? (
            <Skeleton className="h-44 rounded-3xl" />
          ) : isError && !data ? (
            <ErrorState
              message={error?.message ?? t('daily.loadError')}
              onRetry={refetch}
              retrying={isRefetching}
            />
          ) : data && isSummaryEmpty(data) ? (
            <EmptyState
              icon="🗓️"
              title={t('daily.emptyTitle')}
              message={t('daily.emptyMsg')}
            />
          ) : data ? (
            <>
              <ProfitHeroCard summary={data} />
              <Text variant="label" className="mt-7 mb-3">
                {t('daily.topCategories')}
              </Text>
              <TopCategoriesList categories={data.topExpenseCategories} />
            </>
          ) : null}
        </View>

        {/* Notification settings */}
        <View className="mt-8 rounded-2xl border border-border bg-white p-4">
          <Text variant="label" className="mb-2">
            {t('daily.notifLabel')}
          </Text>
          <SegmentedControl
            value={enabled}
            options={ENABLED_OPTIONS}
            onChange={setEnabled}
          />

          <View className="mt-4 flex-row items-center justify-between">
            <Text className="text-sm text-slate-700">{t('daily.deliveryTime')}</Text>
            <View className="flex-row items-center" style={{gap: 16}}>
              <Pressable
                onPress={() => setTime((hour + 23) % 24, minute)}
                className="h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                <Text className="text-lg text-slate-700">−</Text>
              </Pressable>
              <Text className="text-base font-semibold text-slate-900">
                {pad(hour)}:{pad(minute)}
              </Text>
              <Pressable
                onPress={() => setTime((hour + 1) % 24, minute)}
                className="h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                <Text className="text-lg text-slate-700">+</Text>
              </Pressable>
            </View>
          </View>
          <Text variant="caption" className="mt-2">
            {t('daily.deliveryHint')}
          </Text>
        </View>

        <Button
          title={t('daily.sendNow')}
          className="mt-5"
          loading={sending}
          onPress={onSendNow}
        />
        <Button
          title={t('daily.openNotifications')}
          variant="secondary"
          className="mt-2"
          onPress={() => navigation.navigate('Notifications')}
        />
      </View>
    </Screen>
  );
}
