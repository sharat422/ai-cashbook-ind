import React from 'react';
import {Pressable} from 'react-native';

import {Text} from '@components/ui';

export interface FilterChipProps {
  label: string;
  selected?: boolean;
  /** Show a trailing ✕ to signal the chip clears a filter when tapped. */
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
        <Text
          className={`ml-1.5 text-xs ${
            selected ? 'text-white' : 'text-muted'
          }`}>
          ✕
        </Text>
      ) : null}
    </Pressable>
  );
}

export const FilterChip = React.memo(FilterChipBase);
