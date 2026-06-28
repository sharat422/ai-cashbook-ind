import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {ENV} from '@config/env';
import type {CategorizationResult} from '@features/categorization/domain/entities';

/** Big result card: category, confidence bar, AI/Rule source, low-conf flag. */
export function CategoryResultCard({
  result,
}: {
  result: CategorizationResult;
}): React.JSX.Element {
  const pct = Math.round(result.confidence * 100);
  const lowConfidence =
    result.confidence < ENV.categorizationConfidenceThreshold;
  const isAi = result.source === 'ai';

  return (
    <View className="rounded-3xl bg-slate-900 px-5 py-6">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Predicted category
        </Text>
        <View
          className={`flex-row items-center rounded-full px-2.5 py-1 ${
            isAi ? 'bg-primary' : 'bg-slate-700'
          }`}>
          <Text className="text-[11px] font-semibold text-white">
            {isAi ? '✨ AI (GPT)' : '⚙︎ Rule engine'}
          </Text>
        </View>
      </View>

      <Text className="mt-3 text-3xl font-bold text-white">
        {result.category}
      </Text>

      {/* Confidence bar */}
      <View className="mt-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-slate-400">Confidence</Text>
          <Text className="text-xs font-semibold text-white">{pct}%</Text>
        </View>
        <View className="mt-1 h-2 overflow-hidden rounded-full bg-slate-700">
          <View
            className={`h-full rounded-full ${
              lowConfidence ? 'bg-amber-400' : 'bg-success'
            }`}
            style={{width: `${Math.max(pct, 4)}%`}}
          />
        </View>
      </View>

      {lowConfidence ? (
        <Text className="mt-3 text-xs font-medium text-amber-300">
          Low confidence — review and correct below if needed.
        </Text>
      ) : null}
    </View>
  );
}
