import React from 'react';
import {TextInput, View} from 'react-native';

import {Text} from '@components/ui';
import {colors} from '@theme/colors';
import {groupINR, parseAmount} from '@utils/currency';

export interface AmountInputProps {
  /** Numeric value in whole rupees (NaN when empty). */
  value: number;
  onChange: (amount: number) => void;
  error?: string | null;
  autoFocus?: boolean;
}

/**
 * INR amount entry. Displays a fixed ₹ symbol and live Indian digit grouping
 * (12,34,567) while keeping the underlying value a plain number.
 */
export function AmountInput({
  value,
  onChange,
  error,
  autoFocus,
}: AmountInputProps): React.JSX.Element {
  const display = Number.isNaN(value) ? '' : groupINR(String(value));

  return (
    <View
      className={`h-16 flex-row items-center rounded-xl border bg-white px-4 ${
        error ? 'border-danger' : 'border-border'
      }`}>
      <Text className="mr-2 text-3xl font-semibold text-slate-400">₹</Text>
      <TextInput
        className="flex-1 p-0 text-3xl font-semibold text-slate-900"
        value={display}
        onChangeText={text => onChange(parseAmount(text))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.muted}
        autoFocus={autoFocus}
      />
    </View>
  );
}
