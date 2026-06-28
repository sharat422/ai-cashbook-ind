import DateTimePicker from '@react-native-community/datetimepicker';
import React, {useState} from 'react';
import {Platform, Pressable} from 'react-native';

import {Text} from '@components/ui';
import {formatDisplayDate, toISODate} from '@utils/date';

export interface DateFieldProps {
  /** ISO date (YYYY-MM-DD). */
  value: string;
  onChange: (iso: string) => void;
  error?: string | null;
  /** Latest selectable date (defaults to today — no future income dates). */
  maximumDate?: Date;
}

/**
 * Tappable date field backed by the native date picker. Renders an inline
 * spinner on iOS and the system dialog on Android.
 */
export function DateField({
  value,
  onChange,
  error,
  maximumDate = new Date(),
}: DateFieldProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const current = value ? new Date(`${value}T00:00:00`) : new Date();

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className={`h-14 flex-row items-center justify-between rounded-xl border bg-white px-4 ${
          error ? 'border-danger' : 'border-border'
        }`}>
        <Text className={value ? 'text-base text-slate-900' : 'text-base text-muted'}>
          {value ? formatDisplayDate(value) : 'Select date'}
        </Text>
        <Text className="text-muted">📅</Text>
      </Pressable>

      {open ? (
        <DateTimePicker
          value={current}
          mode="date"
          maximumDate={maximumDate}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selected) => {
            // Android fires once and closes; iOS keeps the spinner mounted.
            if (Platform.OS !== 'ios') setOpen(false);
            if (event.type === 'set' && selected) {
              onChange(toISODate(selected));
            }
          }}
        />
      ) : null}
    </>
  );
}
