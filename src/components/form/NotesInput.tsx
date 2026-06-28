import React from 'react';
import {TextInput, View} from 'react-native';

import {Text} from '@components/ui';
import {colors} from '@theme/colors';

export interface NotesInputProps {
  value: string;
  onChange: (text: string) => void;
  error?: string | null;
  maxLength?: number;
  placeholder?: string;
}

/** Multiline notes field with a live character counter. */
export function NotesInput({
  value,
  onChange,
  error,
  maxLength = 280,
  placeholder = 'Add a note (optional)',
}: NotesInputProps): React.JSX.Element {
  return (
    <View>
      <View
        className={`rounded-xl border bg-white px-4 py-3 ${
          error ? 'border-danger' : 'border-border'
        }`}>
        <TextInput
          className="min-h-[72px] p-0 text-base text-slate-900"
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          maxLength={maxLength}
        />
      </View>
      <Text variant="caption" className="mt-1 text-right">
        {value.length}/{maxLength}
      </Text>
    </View>
  );
}
