import React from 'react';
import {Pressable, View} from 'react-native';

import {DateField} from '@components/form';
import {Text} from '@components/ui';

export interface DateRangeFieldProps {
  from: string | null;
  to: string | null;
  onChange: (range: {from: string | null; to: string | null}) => void;
}

/** Reusable from/to date-range picker built on the native DateField. */
export function DateRangeField({
  from,
  to,
  onChange,
}: DateRangeFieldProps): React.JSX.Element {
  const hasValue = !!from || !!to;
  return (
    <View>
      <View className="flex-row" style={{gap: 12}}>
        <View className="flex-1">
          <Text variant="caption" className="mb-1">
            From
          </Text>
          <DateField
            value={from ?? ''}
            onChange={value => onChange({from: value, to})}
          />
        </View>
        <View className="flex-1">
          <Text variant="caption" className="mb-1">
            To
          </Text>
          <DateField
            value={to ?? ''}
            onChange={value => onChange({from, to: value})}
          />
        </View>
      </View>
      {hasValue ? (
        <Pressable
          className="mt-2 self-start"
          onPress={() => onChange({from: null, to: null})}>
          <Text className="text-sm font-semibold text-primary">
            Clear dates
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
