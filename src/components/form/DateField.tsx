import DateTimePicker from '@react-native-community/datetimepicker';
import React, {useState} from 'react';
import {Modal, Platform, Pressable, StyleSheet, View} from 'react-native';

import {Text} from '@components/ui';
import {useT} from '@/i18n';
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
 * Tappable date field backed by the native date picker.
 *
 * Android shows the system dialog, which dismisses itself on pick/cancel. iOS
 * has no self-dismissing inline spinner, so we present it in a modal with an
 * explicit Done/Cancel bar — otherwise the spinner stays open forever (and, with
 * two fields like the report date range, both stay open at once).
 */
export function DateField({
  value,
  onChange,
  error,
  maximumDate = new Date(),
}: DateFieldProps): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Holds the in-progress iOS spinner selection until the user taps Done.
  const [draft, setDraft] = useState<Date>(() =>
    value ? new Date(`${value}T00:00:00`) : new Date(),
  );

  const openPicker = () => {
    setDraft(value ? new Date(`${value}T00:00:00`) : new Date());
    setOpen(true);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={openPicker}
        className={`h-14 flex-row items-center justify-between rounded-xl border bg-white px-4 ${
          error ? 'border-danger' : 'border-border'
        }`}>
        <Text className={value ? 'text-base text-slate-900' : 'text-base text-muted'}>
          {value ? formatDisplayDate(value) : t('common.selectDate')}
        </Text>
        <Text className="text-muted">📅</Text>
      </Pressable>

      {Platform.OS === 'ios' ? (
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}>
          <View className="flex-1 justify-end">
            <Pressable
              style={StyleSheet.absoluteFill}
              className="bg-black/40"
              onPress={() => setOpen(false)}
            />
            <View className="rounded-t-3xl bg-white pb-6">
              <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text className="text-base text-muted">{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onChange(toISODate(draft));
                  setOpen(false);
                }}
                hitSlop={8}>
                <Text className="text-base font-semibold text-primary">
                  {t('common.done')}
                </Text>
              </Pressable>
            </View>
              <DateTimePicker
                value={draft}
                mode="date"
                maximumDate={maximumDate}
                display="spinner"
                onChange={(_event, selected) => {
                  if (selected) setDraft(selected);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : open ? (
        <DateTimePicker
          value={value ? new Date(`${value}T00:00:00`) : new Date()}
          mode="date"
          maximumDate={maximumDate}
          display="default"
          onChange={(event, selected) => {
            // Android fires once then closes; dismiss either way.
            setOpen(false);
            if (event.type === 'set' && selected) {
              onChange(toISODate(selected));
            }
          }}
        />
      ) : null}
    </>
  );
}
