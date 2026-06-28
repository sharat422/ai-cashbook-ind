import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';

export interface RadioOption<K extends string> {
  key: K;
  label: string;
  icon?: string;
}

export interface RadioListProps<K extends string> {
  options: ReadonlyArray<RadioOption<K>>;
  value: K;
  onSelect: (key: K) => void;
}

/** Reusable single-select list with a check on the active row (e.g. sort). */
export function RadioList<K extends string>({
  options,
  value,
  onSelect,
}: RadioListProps<K>): React.JSX.Element {
  return (
    <View>
      {options.map(option => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{selected}}
            onPress={() => onSelect(option.key)}
            className="flex-row items-center justify-between py-3.5">
            <View className="flex-row items-center">
              {option.icon ? (
                <Text className="mr-2 text-base">{option.icon}</Text>
              ) : null}
              <Text
                className={`text-base ${
                  selected ? 'font-semibold text-primary' : 'text-slate-800'
                }`}>
                {option.label}
              </Text>
            </View>
            {selected ? <Text className="text-primary">✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
