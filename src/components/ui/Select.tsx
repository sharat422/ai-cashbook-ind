import React, {useState} from 'react';
import {FlatList, Modal, Pressable, View} from 'react-native';

import {Text} from './Text';

export interface SelectProps<T extends string> {
  label?: string;
  placeholder?: string;
  value: T | null;
  options: readonly T[];
  onSelect: (value: T) => void;
  error?: string | null;
}

/**
 * Bottom-sheet style single-select. Generic over the option string union so
 * callers keep full type-safety on the selected value.
 */
export function Select<T extends string>({
  label,
  placeholder = 'Select an option',
  value,
  options,
  onSelect,
  error,
}: SelectProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <View>
      {label ? (
        <Text variant="label" className="mb-1.5">
          {label}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className={`h-14 flex-row items-center justify-between rounded-xl border bg-white px-4 ${
          error ? 'border-danger' : 'border-border'
        }`}>
        <Text className={value ? 'text-base text-slate-900' : 'text-base text-muted'}>
          {value ?? placeholder}
        </Text>
        <Text className="text-muted">▾</Text>
      </Pressable>

      {error ? (
        <Text className="mt-1 text-xs text-danger">{error}</Text>
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}>
        <Pressable
          className="flex-1 justify-end bg-black/40"
          onPress={() => setOpen(false)}>
          <Pressable className="max-h-[70%] rounded-t-3xl bg-white p-5">
            {label ? (
              <Text variant="title" className="mb-3 text-lg">
                {label}
              </Text>
            ) : null}
            <FlatList
              data={options as T[]}
              keyExtractor={item => item}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => (
                <View className="h-px bg-border" />
              )}
              renderItem={({item}) => {
                const selected = item === value;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect(item);
                      setOpen(false);
                    }}
                    className="flex-row items-center justify-between py-4">
                    <Text
                      className={`text-base ${
                        selected
                          ? 'font-semibold text-primary'
                          : 'text-slate-900'
                      }`}>
                      {item}
                    </Text>
                    {selected ? <Text className="text-primary">✓</Text> : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
