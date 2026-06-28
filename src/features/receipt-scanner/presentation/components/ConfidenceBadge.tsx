import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {
  confidenceLevel,
  type Confidence,
} from '@features/receipt-scanner/domain/entities';

const STYLE = {
  high: {bg: 'bg-green-50', text: 'text-success', label: 'High'},
  medium: {bg: 'bg-amber-50', text: 'text-amber-700', label: 'Medium'},
  low: {bg: 'bg-red-50', text: 'text-danger', label: 'Low'},
} as const;

/** Small pill showing the AI's confidence in an extracted value. */
function ConfidenceBadgeBase({
  confidence,
}: {
  confidence: Confidence;
}): React.JSX.Element {
  const level = confidenceLevel(confidence);
  const s = STYLE[level];
  const pct = Math.round(confidence * 100);
  return (
    <View className={`flex-row items-center rounded-full px-2 py-0.5 ${s.bg}`}>
      <Text className={`text-[10px] font-semibold ${s.text}`}>
        {s.label} · {pct}%
      </Text>
    </View>
  );
}

export const ConfidenceBadge = React.memo(ConfidenceBadgeBase);
