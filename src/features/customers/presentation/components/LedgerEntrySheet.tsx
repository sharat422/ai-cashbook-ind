import React, {useEffect, useState} from 'react';
import {View} from 'react-native';

import {AmountInput, DateField, FormField, NotesInput} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import type {LedgerEntryType} from '@features/customers/domain/ledger';
import {toISODate} from '@utils/date';

export interface LedgerEntrySheetProps {
  /** Which entry to add, or null when the sheet is closed. */
  mode: LedgerEntryType | null;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (input: {amount: number; date: string; notes?: string}) => void;
}

/**
 * Bottom-sheet form for adding a credit or recording a payment. Reused for both
 * flows — the `mode` only changes the copy and accent.
 */
export function LedgerEntrySheet({
  mode,
  submitting,
  onClose,
  onSubmit,
}: LedgerEntrySheetProps): React.JSX.Element {
  const [amount, setAmount] = useState<number>(NaN);
  const [date, setDate] = useState<string>(toISODate(new Date()));
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the sheet (re)opens.
  useEffect(() => {
    if (mode) {
      setAmount(NaN);
      setDate(toISODate(new Date()));
      setNotes('');
      setError(null);
    }
  }, [mode]);

  const isCredit = mode === 'credit';
  const title = isCredit ? 'Add credit' : 'Receive payment';

  const submit = () => {
    if (Number.isNaN(amount) || amount <= 0) {
      setError('Enter an amount greater than ₹0');
      return;
    }
    onSubmit({amount, date, notes: notes.trim() || undefined});
  };

  return (
    <BottomSheet
      visible={mode !== null}
      onClose={onClose}
      title={title}
      maxHeightClassName="max-h-[80%]">
      <View className="px-5 pb-4 pt-1" style={{gap: 16}}>
        <Text variant="caption">
          {isCredit
            ? 'Record goods/services given on credit. This increases the dues.'
            : 'Record money received. This reduces the dues.'}
        </Text>

        <FormField label="Amount" required error={error}>
          <AmountInput
            value={amount}
            onChange={value => {
              setAmount(value);
              if (error) setError(null);
            }}
            error={error}
            autoFocus
          />
        </FormField>

        <FormField label="Date">
          <DateField value={date} onChange={setDate} />
        </FormField>

        <FormField label="Notes" hint="Optional">
          <NotesInput
            value={notes}
            onChange={setNotes}
            placeholder={
              isCredit ? 'e.g. 2 bags cement' : 'e.g. UPI payment'
            }
            maxLength={200}
          />
        </FormField>

        <Button
          title={isCredit ? 'Add credit' : 'Receive payment'}
          loading={submitting}
          onPress={submit}
        />
      </View>
    </BottomSheet>
  );
}
