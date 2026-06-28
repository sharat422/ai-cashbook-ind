import React, {forwardRef} from 'react';
import {TextInput, TextInputProps, View} from 'react-native';

import {colors} from '@theme/colors';
import {Text} from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  /** Static prefix rendered inside the field, e.g. "+91". */
  prefix?: string;
  containerClassName?: string;
}

/** Labeled text field with inline error + optional prefix. */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {label, error, prefix, containerClassName, className, ...props},
  ref,
) {
  return (
    <View className={containerClassName}>
      {label ? (
        <Text variant="label" className="mb-1.5">
          {label}
        </Text>
      ) : null}

      <View
        className={`h-14 flex-row items-center rounded-xl border bg-white px-4 ${
          error ? 'border-danger' : 'border-border'
        }`}>
        {prefix ? (
          <Text className="mr-2 text-base text-muted">{prefix}</Text>
        ) : null}
        <TextInput
          ref={ref}
          className="flex-1 p-0 text-base text-slate-900"
          placeholderTextColor={colors.muted}
          {...props}
        />
      </View>

      {error ? (
        <Text className="mt-1 text-xs text-danger">{error}</Text>
      ) : null}
    </View>
  );
});
