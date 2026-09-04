import React from 'react';
import {Alert, FlatList, Pressable, RefreshControl, View} from 'react-native';

import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {
  frequencyLabel,
  type RecurringExpense,
} from '@features/recurring/domain/entities';
import {
  useRecurringExpenses,
  useRecurringMutations,
} from '@features/recurring/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

export function RecurringListScreen({
  navigation,
}: AppScreenProps<'Recurring'>): React.JSX.Element {
  const t = useT();
  const {data, isLoading, isError, error, refetch, isRefetching} =
    useRecurringExpenses();
  const {post} = useRecurringMutations();

  const items = data?.items ?? [];
  const showSkeleton = isLoading && items.length === 0;
  const showError = isError && items.length === 0;
  const showEmpty = !isLoading && !isError && items.length === 0;

  const onPost = (rec: RecurringExpense) => {
    Alert.alert(
      t('recurring.postTitle'),
      t('recurring.postMsg', {
        amount: formatINR(rec.amount),
        name: rec.name,
        date: formatDisplayDate(rec.nextDueDate),
      }),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('recurring.record'),
          onPress: () =>
            post.mutate(rec.id, {
              onError: e =>
                Alert.alert(
                  t('recurring.couldNotRecord'),
                  e instanceof Error ? e.message : t('ai.tryAgain'),
                ),
            }),
        },
      ],
    );
  };

  return (
    <Screen scroll={false} edges={['top']}>
      <View className="pb-3 pt-4">
        <View className="flex-row items-center justify-between">
          <Text variant="title">{t('recurring.title')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('RecurringForm')}
            className="rounded-full bg-primary px-4 py-2">
            <Text className="text-sm font-semibold text-white">
              {t('recurring.add')}
            </Text>
          </Pressable>
        </View>
        <Text variant="caption" className="mt-1">
          {t('recurring.subtitle')}
        </Text>

        {data && items.length > 0 ? (
          <View className="mt-4 flex-row rounded-2xl bg-slate-900 p-4" style={{gap: 10}}>
            <Summary label={t('recurring.dueNow')} value={`${data.dueCount}`} accent="text-amber-300" />
            <Summary label={t('recurring.dueAmount')} value={formatINR(data.dueTotal)} accent="text-red-300" />
            <Summary
              label={t('recurring.perMonth')}
              value={formatINR(data.monthlyTotal)}
              accent="text-green-300"
            />
          </View>
        ) : null}
      </View>

      <View className="flex-1">
        {showSkeleton ? (
          <View style={{gap: 12}}>
            {Array.from({length: 5}).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </View>
        ) : showError ? (
          <View className="flex-1 justify-center">
            <ErrorState
              message={error?.message ?? t('recurring.loadError')}
              onRetry={refetch}
              retrying={isRefetching}
            />
          </View>
        ) : showEmpty ? (
          <View className="flex-1 justify-center">
            <EmptyState
              icon="🔁"
              title={t('recurring.emptyTitle')}
              message={t('recurring.emptyMsg')}
              actionLabel={t('recurring.addFirst')}
              onAction={() => navigation.navigate('RecurringForm')}
            />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={r => r.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{paddingBottom: 24, gap: 10}}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetch}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            renderItem={({item}) => (
              <RecurringRow
                rec={item}
                posting={post.isPending && post.variables === item.id}
                onEdit={() => navigation.navigate('RecurringForm', {recurring: item})}
                onPost={() => onPost(item)}
              />
            )}
          />
        )}
      </View>
    </Screen>
  );
}

function RecurringRow({
  rec,
  posting,
  onEdit,
  onPost,
}: {
  rec: RecurringExpense;
  posting: boolean;
  onEdit: () => void;
  onPost: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <Pressable
      onPress={onEdit}
      className={`rounded-2xl border bg-white px-4 py-3 ${
        rec.isDue ? 'border-amber-400' : 'border-border'
      }`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center" style={{gap: 6}}>
            <Text className="font-semibold text-slate-900" numberOfLines={1}>
              {rec.name}
            </Text>
            {!rec.active ? (
              <Text className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                {t('recurring.paused')}
              </Text>
            ) : rec.isDue ? (
              <Text className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                {t('recurring.due')}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" className="mt-0.5">
            {frequencyLabel(rec.frequency, rec.interval)} · {rec.category}
            {rec.active
              ? ` · ${t('recurring.next', {date: formatDisplayDate(rec.nextDueDate)})}`
              : ''}
          </Text>
        </View>
        <Text className="text-base font-semibold text-slate-900">
          {formatINR(rec.amount)}
        </Text>
      </View>

      {rec.isDue ? (
        <Button
          title={posting ? t('recurring.recording') : t('recurring.markPaid')}
          className="mt-3"
          loading={posting}
          onPress={onPost}
        />
      ) : null}
    </Pressable>
  );
}

function Summary({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}): React.JSX.Element {
  return (
    <View className="flex-1">
      <Text className="text-[10px] uppercase text-slate-400">{label}</Text>
      <Text
        className={`mt-0.5 text-lg font-bold ${accent}`}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}
