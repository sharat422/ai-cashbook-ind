import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';

export interface ChipOption<T extends string> {
  value: T;
  /** Optional leading emoji/icon for a friendlier look. */
  icon?: string;
}

export interface ChipSelectProps<T extends string> {
  value: T | null;
  options: ReadonlyArray<ChipOption<T> | T>;
  onSelect: (value: T) => void;
  error?: string | null;
}

function normalize<T extends string>(
  option: ChipOption<T> | T,
): ChipOption<T> {
  return typeof option === 'string' ? {value: option} : option;
}

/**
 * Wrapping pill/chip single-select — a faster, more tactile alternative to a
 * dropdown for short option lists (e.g. expense categories). Generic over the
 * option union so the selected value stays type-safe.
 */
export function ChipSelect<T extends string>({
  value,
  options,
  onSelect,
  error,
}: ChipSelectProps<T>): React.JSX.Element {
  return (
    <View>
      <View className="flex-row flex-wrap" style={{gap: 8}}>
        {options.map(raw => {
          const option = normalize(raw);
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{selected}}
              onPress={() => onSelect(option.value)}
              className={`flex-row items-center rounded-full border px-4 py-2 ${
                selected
                  ? 'border-primary bg-primary'
                  : 'border-border bg-white'
              }`}>
              {option.icon ? (
                <Text className="mr-1.5 text-base">{option.icon}</Text>
              ) : null}
              <Text
                className={`text-sm font-medium ${
                  selected ? 'text-white' : 'text-slate-700'
                }`}>
                {option.value}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text className="mt-1 text-xs text-danger">{error}</Text>
      ) : null}
    </View>
  );
}
