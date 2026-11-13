import React, {useEffect, useState} from 'react';
import {View} from 'react-native';

// Not the '@components/form' barrel: it pulls in the photo picker, which Sync status doesn't need.
import {AmountInput} from '@components/form/AmountInput';
import {DateField} from '@components/form/DateField';
import {FormField} from '@components/form/FormField';
import {TextField} from '@components/form/TextField';
import {BottomSheet, Button} from '@components/ui';
import {useT, type TKey} from '@/i18n';
import type {Fix} from '../failedEntries';

/** Fix a failed entry before it syncs again (IM5): amount, date, reference, notes. */
export function EditQueuedSheet({fix, referenceLabel, onClose, onSave}: {
  fix: Fix | null;
  referenceLabel?: TKey;
  onClose: () => void;
  onSave: (fix: Fix) => void;
}): React.JSX.Element {
  const t = useT();
  const [amount, setAmount] = useState(NaN);
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!fix) return;
    setAmount(fix.amount);
    setDate(fix.date);
    setReference(fix.reference ?? '');
    setNotes(fix.notes ?? '');
  }, [fix]);
  const valid = Number.isFinite(amount) && amount > 0 && !!date;

  return (
    <BottomSheet visible={fix !== null} onClose={onClose} title={t('sync.editTitle')}>
      <View className="px-5 pb-5 pt-1" style={{gap: 12}}>
        <FormField label={t('form.amount')}>
          <AmountInput value={amount} onChange={setAmount} />
        </FormField>
        <FormField label={t('form.date')}>
          <DateField value={date} onChange={setDate} />
        </FormField>
        {referenceLabel ? (
          <FormField label={t(referenceLabel)}>
            <TextField testID="edit-queued-reference" value={reference} onChangeText={setReference} />
          </FormField>
        ) : null}
        <FormField label={t('form.notes')}>
          <TextField value={notes} onChangeText={setNotes} />
        </FormField>
        <Button testID="edit-queued-save" title={t('sync.editSave')} disabled={!valid}
          onPress={() => onSave({amount, date, notes: notes.trim() || undefined, reference: reference.trim() || undefined})} />
      </View>
    </BottomSheet>
  );
}
