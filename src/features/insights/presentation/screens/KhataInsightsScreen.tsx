import React, {useCallback} from 'react';
import {RefreshControl, ScrollView, View} from 'react-native';

import {ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {Insight} from '@features/insights/domain/entities';
import {InsightCard} from '@features/insights/presentation/components';
import {useInsights} from '@features/insights/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';

/** AI Khata Insights — beautiful cards with drill-down navigation. */
export function KhataInsightsScreen({
  navigation,
}: AppScreenProps<'KhataInsights'>): React.JSX.Element {
  const t = useT();
  const {data, isLoading, isError, error, refetch, isRefetching} = useInsights();

  const onDrill = useCallback(
    (insight: Insight) => {
      const {drill} = insight;
      if (drill.target === 'khata') {
        navigation.navigate('KhataDashboard');
      } else if (drill.target === 'customers') {
        navigation.navigate(
          'Customers',
          drill.search ? {search: drill.search} : undefined,
        );
      }
    },
    [navigation],
  );

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }>
        {/* Hero */}
        <View className="rounded-3xl bg-slate-900 px-5 py-6">
          <Text className="text-2xl font-bold text-white">
            {t('insights.heroTitle')}
          </Text>
          <Text className="mt-1 text-sm text-slate-400">
            {t('insights.heroSub')}
          </Text>
        </View>

        <View className="mt-5">
          {isLoading && !data ? (
            <SkeletonCards />
          ) : isError && !data ? (
            <ErrorState
              message={error?.message ?? t('insights.loadError')}
              onRetry={refetch}
              retrying={isRefetching}
            />
          ) : data && data.length > 0 ? (
            data.map((insight: Insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                onPress={onDrill}
              />
            ))
          ) : (
            <Text variant="caption">{t('insights.empty')}</Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function SkeletonCards(): React.JSX.Element {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({length: 4}).map((_, i) => (
        <Skeleton key={i} className="mb-3 h-28 rounded-2xl" />
      ))}
    </View>
  );
}
