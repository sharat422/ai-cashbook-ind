import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {
  needsReview,
  type Confidence,
} from '@features/receipt-scanner/domain/entities';
import {ConfidenceBadge} from './ConfidenceBadge';

export interface ExtractedFieldRowProps {
  label: string;
  confidence: Confidence;
  /** The editable control (TextField, AmountInput, DateField, …). */
  children: React.ReactNode;
}

/**
 * Wraps an editable control with its label and AI confidence badge. Low-
 * confidence fields get a "Please verify" hint so the user knows what to check.
 */
export function ExtractedFieldRow({
  label,
  confidence,
  children,
}: ExtractedFieldRowProps): React.JSX.Element {
  const review = needsReview(confidence);
  return (
    <View>
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text variant="label">{label}</Text>
        <ConfidenceBadge confidence={confidence} />
      </View>
      {children}
      {review ? (
        <Text className="mt-1 text-xs text-danger">
          Low confidence — please verify this value.
        </Text>
      ) : null}
    </View>
  );
}
