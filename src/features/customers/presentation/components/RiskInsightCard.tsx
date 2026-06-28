import React from 'react';
import {View} from 'react-native';

import {AiInsightCard, Text} from '@components/ui';
import type {
  RiskFeatures,
  RiskPrediction,
} from '@features/customers/domain/risk';
import {formatINR} from '@utils/currency';
import {RiskBadge} from './RiskBadge';
import {RiskGauge} from './RiskGauge';

interface Props {
  prediction: RiskPrediction;
  features: RiskFeatures;
}

function Stat({label, value}: {label: string; value: string}): React.JSX.Element {
  return (
    <View className="flex-1">
      <Text className="text-[10px] uppercase text-muted">{label}</Text>
      <Text className="mt-0.5 text-sm font-semibold text-slate-900" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * AI payment-risk insight: gauge, badge, confidence, the factors behind the
 * score, the inputs it used, and recommended actions. Reuses AiInsightCard.
 */
export function RiskInsightCard({
  prediction,
  features,
}: Props): React.JSX.Element {
  const confidencePct = Math.round(prediction.confidence * 100);

  return (
    <AiInsightCard
      icon="🤖"
      title="Payment Risk"
      subtitle="AI prediction"
      badge={<RiskBadge category={prediction.category} />}>
      <RiskGauge score={prediction.score} category={prediction.category} />

      {/* Prediction confidence */}
      <View className="mt-2">
        <View className="flex-row items-center justify-between">
          <Text variant="caption">Prediction confidence</Text>
          <Text className="text-xs font-semibold text-slate-900">
            {confidencePct}%
          </Text>
        </View>
        <View className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
          <View
            className="h-full rounded-full bg-primary"
            style={{width: `${Math.max(confidencePct, 4)}%`}}
          />
        </View>
      </View>

      {/* Inputs used */}
      <View className="mt-4 flex-row rounded-xl bg-slate-50 p-3" style={{gap: 8}}>
        <Stat label="Outstanding" value={formatINR(features.outstandingAmount)} />
        <Stat
          label="Avg delay"
          value={`${Math.round(features.avgPaymentDelayDays)}d`}
        />
        <Stat
          label="Txns/mo"
          value={features.transactionFrequencyPerMonth.toFixed(1)}
        />
      </View>

      {/* Factors */}
      {prediction.factors.length > 0 ? (
        <View className="mt-4">
          <Text variant="label" className="mb-2">
            Why
          </Text>
          <View className="flex-row flex-wrap" style={{gap: 6}}>
            {prediction.factors.map(f => (
              <View
                key={f.label}
                className={`flex-row items-center rounded-full px-2.5 py-1 ${
                  f.impact === 'increase' ? 'bg-red-50' : 'bg-green-50'
                }`}>
                <Text
                  className={`text-[11px] font-semibold ${
                    f.impact === 'increase' ? 'text-danger' : 'text-success'
                  }`}>
                  {f.impact === 'increase' ? '↑' : '↓'} {f.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Suggested actions */}
      <View className="mt-4">
        <Text variant="label" className="mb-2">
          Suggested actions
        </Text>
        <View style={{gap: 6}}>
          {prediction.suggestedActions.map(action => (
            <View key={action} className="flex-row items-start">
              <Text className="mr-2 text-primary">•</Text>
              <Text className="flex-1 text-sm text-slate-700">{action}</Text>
            </View>
          ))}
        </View>
      </View>
    </AiInsightCard>
  );
}
