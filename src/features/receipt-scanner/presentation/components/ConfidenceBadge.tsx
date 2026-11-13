import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {useT} from '@/i18n';
import {
  confidenceLevel,
  type Confidence,
} from '@features/receipt-scanner/domain/entities';

const STYLE = {
  high: {bg: 'bg-green-50', text: 'text-success', label: 'receipt.confHigh'},
  medium: {bg: 'bg-amber-50', text: 'text-amber-700', label: 'receipt.confMedium'},
  low: {bg: 'bg-red-50', text: 'text-danger', label: 'receipt.confLow'},
} as const;

/** Small pill showing the AI's confidence in an extracted value. */
function ConfidenceBadgeBase({
  confidence,
}: {
  confidence: Confidence;
}): React.JSX.Element {
  const t = useT();
  const level = confidenceLevel(confidence);
  const s = STYLE[level];
  const pct = Math.round(confidence * 100);
  return (
    <View className={`flex-row items-center rounded-full px-2 py-0.5 ${s.bg}`}>
      <Text className={`text-[10px] font-semibold ${s.text}`}>
        {t(s.label)} · {pct}%
      </Text>
    </View>
  );
}

export const ConfidenceBadge = React.memo(ConfidenceBadgeBase);
