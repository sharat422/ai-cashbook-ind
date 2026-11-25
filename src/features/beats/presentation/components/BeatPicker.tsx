import React, {useEffect, useRef} from 'react';
import {View} from 'react-native';

import {FilterChip} from '@components/filters';
import {FormField} from '@components/form';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {Beat, BeatRetailer} from '@features/beats/data/beats.remote';
import {useBeats} from '@features/beats/presentation/hooks';
import {useT} from '@/i18n';

/**
 * Which beat a credit or payment counts for (that beat's ledger and daily
 * close). Offers the beats this customer is on that the caller may see — the
 * server sends staff only their own and refuses any other. Staff start on
 * their beat; owners start on none, so cash taken at the shop isn't put on a
 * salesperson's close. Shows nothing when the customer is on no beat.
 */
export function BeatPicker({customerId, value, onChange}: {
  customerId: string;
  value: string | undefined;
  onChange: (beatId: string | undefined) => void;
}): React.JSX.Element | null {
  const t = useT();
  const {can} = usePermissions();
  const beats = useBeats();
  const options = (beats.data ?? []).filter((b: Beat) => b.retailers.some((r: BeatRetailer) => r.customerId === customerId));
  const defaulted = useRef(value !== undefined);
  useEffect(() => {
    if (defaulted.current || !options.length) return;
    defaulted.current = true;
    if (!can(PERMISSIONS.DATA_VIEW)) onChange(options[0].id); // staff: their beat
  }, [options, can, onChange]);

  if (!options.length) return null;
  return (
    <FormField label={t('beats.beatLabel')} hint={t('common.optional')}>
      <View className="flex-row flex-wrap" style={{gap: 8}}>
        <FilterChip testID="beat-none" label={t('beats.noBeatOption')} selected={!value}
          onPress={() => onChange(undefined)} />
        {options.map((b: Beat) => (
          <FilterChip key={b.id} testID={`beat-pick-${b.id}`} label={b.name} selected={value === b.id}
            onPress={() => onChange(b.id)} />
        ))}
      </View>
    </FormField>
  );
}
