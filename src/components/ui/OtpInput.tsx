import React, {useRef} from 'react';
import {Pressable, TextInput, View} from 'react-native';

import {onlyDigits} from '@utils/validation';
import {Text} from './Text';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
}

/**
 * Segmented OTP entry. A single hidden TextInput owns the value; the boxes are
 * purely presentational, which keeps paste/autofill behaviour reliable.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus = true,
}: OtpInputProps): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);
  const digits = value.split('');
  const focusIndex = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()}>
      <View className="flex-row justify-between">
        {Array.from({length}).map((_, i) => {
          const isActive = i === focusIndex;
          const filled = !!digits[i];
          return (
            <View
              key={i}
              className={`h-14 w-12 items-center justify-center rounded-xl border ${
                isActive
                  ? 'border-primary bg-primary/5'
                  : filled
                  ? 'border-slate-300 bg-white'
                  : 'border-border bg-white'
              }`}>
              <Text className="text-xl font-semibold text-slate-900">
                {digits[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={text => onChange(onlyDigits(text).slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        // Visually hidden but still focusable/typeable.
        className="absolute h-px w-px opacity-0"
      />
    </Pressable>
  );
}
