import React from 'react';
import {Pressable, TextInput, View} from 'react-native';

import {Icon, Text} from '@components/ui';
import {colors} from '@theme/colors';

export interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
}

/** Reusable search input with a leading icon and a clear button. */
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search…',
  onClear,
}: SearchBarProps): React.JSX.Element {
  return (
    <View className="h-12 flex-row items-center rounded-xl border border-border bg-white px-3">
      <Icon name="search" size={18} color={colors.muted} />
      <TextInput
        className="flex-1 p-0 text-base text-slate-900"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          onPress={() => {
            onChangeText('');
            onClear?.();
          }}
          className="ml-2 h-6 w-6 items-center justify-center rounded-full bg-slate-200">
          <Icon name="x" size={12} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
