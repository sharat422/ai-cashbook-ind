import React, {useState} from 'react';
import {Pressable, View} from 'react-native';

import {DateField} from '@components/form/DateField';
import {Text} from '@components/ui';
import {useT} from '@/i18n';

export interface DateRangeFieldProps {
  from: string | null;
  to: string | null;
  onChange: (range: {from: string | null; to: string | null}) => void;
}

/**
 * Reusable from/to date-range picker built on the native DateField. A To date
 * before the From date is refused with an error; the range stays as it was.
 */
export function DateRangeField({
  from,
  to,
  onChange,
}: DateRangeFieldProps): React.JSX.Element {
  const t = useT();
  const [bad, setBad] = useState<'from' | 'to' | null>(null);
  const hasValue = !!from || !!to;

  const pick = (which: 'from' | 'to', value: string) => {
    const next = which === 'from' ? {from: value, to} : {from, to: value};
    if (next.from && next.to && next.from > next.to) {
      setBad(which);
      return;
    }
    setBad(null);
    onChange(next);
  };

  return (
    <View>
      <View className="flex-row" style={{gap: 12}}>
        <View className="flex-1">
          <Text variant="caption" className="mb-1">
            {t('common.from')}
          </Text>
          <DateField
            value={from ?? ''}
            error={bad === 'from' ? t('common.toBeforeFrom') : null}
            onChange={value => pick('from', value)}
          />
        </View>
        <View className="flex-1">
          <Text variant="caption" className="mb-1">
            {t('common.to')}
          </Text>
          <DateField
            value={to ?? ''}
            error={bad === 'to' ? t('common.toBeforeFrom') : null}
            onChange={value => pick('to', value)}
          />
        </View>
      </View>
      {bad ? (
        <Text testID="date-range-error" className="mt-1 text-sm text-danger">
          {t('common.toBeforeFrom')}
        </Text>
      ) : null}
      {hasValue ? (
        <Pressable
          className="mt-2 self-start"
          onPress={() => {
            setBad(null);
            onChange({from: null, to: null});
          }}>
          <Text className="text-sm font-semibold text-primary">
            {t('common.clearDates')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
