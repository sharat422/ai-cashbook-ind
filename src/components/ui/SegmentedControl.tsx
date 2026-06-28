import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from './Text';

export interface SegmentedOption<T> {
  label: string;
  value: T;
}

export interface SegmentedControlProps<T> {
  label?: string;
  value: T | null;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  error?: string | null;
}

/** Two/few-option toggle — used here for the GST Registered Yes/No choice. */
export function SegmentedControl<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  error,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <View>
      {label ? (
        <Text variant="label" className="mb-1.5">
          {label}
        </Text>
      ) : null}

      <View
        className={`flex-row rounded-xl border bg-white p-1 ${
          error ? 'border-danger' : 'border-border'
        }`}>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => onChange(option.value)}
              className={`h-11 flex-1 items-center justify-center rounded-lg ${
                selected ? 'bg-primary' : 'bg-transparent'
              }`}>
              <Text
                className={`text-base font-medium ${
                  selected ? 'text-white' : 'text-slate-700'
                }`}>
                {option.label}
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
