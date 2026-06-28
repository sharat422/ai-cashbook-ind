import React, {forwardRef} from 'react';
import {TextInput, TextInputProps, View} from 'react-native';

import {colors} from '@theme/colors';

export interface TextFieldProps extends TextInputProps {
  error?: string | null;
}

/**
 * Single-line text control (no label/error text of its own — pair it with
 * <FormField/>). Keeps borders/heights consistent with the other form inputs.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextField({error, className, ...props}, ref) {
    return (
      <View
        className={`h-14 flex-row items-center rounded-xl border bg-white px-4 ${
          error ? 'border-danger' : 'border-border'
        }`}>
        <TextInput
          ref={ref}
          className={`flex-1 p-0 text-base text-slate-900 ${className ?? ''}`}
          placeholderTextColor={colors.muted}
          {...props}
        />
      </View>
    );
  },
);
