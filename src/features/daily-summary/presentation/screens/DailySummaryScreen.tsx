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
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

const ENABLED_OPTIONS = [
  {label: 'On', value: true},
  {label: 'Off', value: false},
] as const;

const pad = (n: number) => `${n}`.padStart(2, '0');

/**
 * Daily Summary Engine UI: income / expense / profit + top expense categories,
 * with the notification schedule controls and a manual "send now".
 */
export function DailySummaryScreen({
  navigation,
}: AppScreenProps<'DailySummary'>): React.JSX.Element {
  const today = toISODate(new Date());
  const {data, isLoading, isError, error, refetch, isRefetching} =
    useDailySummary(today);

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
        'Summary sent',
        delivered.length > 0
          ? `Delivered to: ${delivered.join(', ')}. Check the bell on the dashboard.`
          : 'No channels were available to deliver to.',
      );
    } catch (e) {
      Alert.alert(
        'Could not send',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">Daily Summary</Text>
        <Text variant="subtitle" className="mt-2">
          Your income, expenses and profit for today.
        </Text>

        {/* Summary */}
        <View className="mt-6">
          {isLoading && !data ? (
            <Skeleton className="h-44 rounded-3xl" />
          ) : isError && !data ? (
            <ErrorState
              message={error?.message ?? 'Could not generate the summary.'}
              onRetry={refetch}
              retrying={isRefetching}
            />
          ) : data && isSummaryEmpty(data) ? (
            <EmptyState
              icon="🗓️"
              title="Nothing recorded today"
              message="Add income or an expense and your summary will appear here."
            />
          ) : data ? (
            <>
              <ProfitHeroCard summary={data} />
              <Text variant="label" className="mt-7 mb-3">
                Top expense categories
              </Text>
              <TopCategoriesList categories={data.topExpenseCategories} />
            </>
          ) : null}
        </View>

        {/* Notification settings */}
        <View className="mt-8 rounded-2xl border border-border bg-white p-4">
          <Text variant="label" className="mb-2">
            Daily summary notification
          </Text>
          <SegmentedControl
            value={enabled}
            options={ENABLED_OPTIONS}
            onChange={setEnabled}
          />

          <View className="mt-4 flex-row items-center justify-between">
            <Text className="text-sm text-slate-700">Delivery time</Text>
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
            Delivered to the in-app inbox{' '}
            {/* WhatsApp lights up once enabled in env + backend */}
            (WhatsApp when enabled). Background delivery needs the OS scheduler —
            see the docs.
          </Text>
        </View>

        <Button
          title="Send summary now"
          className="mt-5"
          loading={sending}
          onPress={onSendNow}
        />
        <Button
          title="Open notifications"
          variant="secondary"
          className="mt-2"
          onPress={() => navigation.navigate('Notifications')}
        />
      </View>
    </Screen>
  );
}
