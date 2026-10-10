import React from 'react';
import {Pressable, View} from 'react-native';

import {Icon, Text} from '@components/ui';
import {colors} from '@theme/colors';

export interface FilterChipProps {
  label: string;
  selected?: boolean;
  /** Show a trailing × to signal the chip clears a filter when tapped. */
  removable?: boolean;
  onPress: () => void;
}

/** Reusable toggle/removable pill used across filter UIs. */
function FilterChipBase({
  label,
  selected,
  removable,
  onPress,
}: FilterChipProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: !!selected}}
      onPress={onPress}
      className={`flex-row items-center rounded-full border px-3.5 py-2 ${
        selected ? 'border-primary bg-primary' : 'border-border bg-white'
      }`}>
      <Text
        className={`text-sm font-medium ${
          selected ? 'text-white' : 'text-slate-700'
        }`}>
        {label}
      </Text>
      {removable ? (
        <View className="ml-1.5">
          <Icon
            name="x"
            size={12}
            color={selected ? '#FFFFFF' : colors.muted}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

export const FilterChip = React.memo(FilterChipBase);
