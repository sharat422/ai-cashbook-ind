import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import type {Insight} from '@features/insights/domain/entities';
import {SENTIMENT_STYLE, TYPE_ICON} from './insightStyle';

export interface InsightCardProps {
  insight: Insight;
  onPress: (insight: Insight) => void;
}

/**
 * Premium, fintech-style insight card: a coloured accent rail, icon chip,
 * headline, supporting detail, a metric pill, and a drill-down affordance.
 */
function InsightCardBase({
  insight,
  onPress,
}: InsightCardProps): React.JSX.Element {
  const s = SENTIMENT_STYLE[insight.sentiment];
  const drillable = insight.drill.target !== 'none';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!drillable}
      onPress={() => onPress(insight)}
      className="mb-3 flex-row overflow-hidden rounded-2xl border border-border bg-white"
      style={{
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: {width: 0, height: 5},
        elevation: 2,
      }}>
      {/* Accent rail */}
      <View className={`w-1.5 ${s.bar}`} />

      <View className="flex-1 p-4">
        <View className="flex-row items-start justify-between">
          <View
            className={`h-9 w-9 items-center justify-center rounded-full ${s.iconBg}`}>
            <Text className="text-base">{TYPE_ICON[insight.type]}</Text>
          </View>
          {insight.metric ? (
            <View className={`rounded-full px-2.5 py-1 ${s.chipBg}`}>
              <Text className={`text-xs font-bold ${s.metricText}`}>
                {insight.metric}
              </Text>
            </View>
          ) : null}
        </View>

        <Text className="mt-3 text-base font-semibold leading-5 text-slate-900">
          {insight.title}
        </Text>
        {insight.detail ? (
          <Text variant="caption" className="mt-1">
            {insight.detail}
          </Text>
        ) : null}

        {drillable ? (
          <Text className="mt-3 text-sm font-semibold text-primary">
            View details →
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const InsightCard = React.memo(InsightCardBase);
