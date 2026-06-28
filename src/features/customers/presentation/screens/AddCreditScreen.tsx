import React, {useEffect, useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {
  AmountInput,
  AttachmentPicker,
  DateField,
  FormField,
  NotesInput,
  TextField,
} from '@components/form';
import {Button, Screen, SuccessOverlay, Text} from '@components/ui';
import type {Attachment} from '@/shared/types/attachment';
import {useLedgerMutations} from '@features/customers/presentation/hooks';
import {useCreditDraftStore} from '@features/customers/presentation/store/creditDraft.store';
import {useConnectivity} from '@features/income/presentation/hooks';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {toISODate} from '@utils/date';

const QUICK_AMOUNTS = [500, 1000, 5000, 10000];

/**
 * Add Credit (Udhaar) — a focused, premium entry screen with a large amount
 * field, quick-amount buttons, attachment upload, draft save, offline support,
 * and an animated success confirmation.
 */
export function AddCreditScreen({
  navigation,
  route,
}: AppScreenProps<'AddCredit'>): React.JSX.Element {
  const {customer} = route.params;
  const online = useConnectivity();
  const {addCredit} = useLedgerMutations(customer.id);
  const saveDraft = useCreditDraftStore(s => s.saveDraft);
  const clearDraft = useCreditDraftStore(s => s.clearDraft);

  const [amount, setAmount] = useState<number>(NaN);
  const [date, setDate] = useState<string>(toISODate(new Date()));
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [success, setSuccess] = useState(false);

  // Restore a saved draft for this customer on first mount.
  useEffect(() => {
    const draft = useCreditDraftStore.getState().drafts[customer.id];
    if (draft) {
      setAmount(draft.amount);
      setDate(draft.date);
      setInvoiceNumber(draft.invoiceNumber);
      setNotes(draft.notes);
      setAttachment(draft.attachment);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addQuick = (value: number) => {
    setAmount(prev => (Number.isNaN(prev) ? 0 : prev) + value);
    if (error) setError(null);
  };

  const currentDraft = () => ({
    amount,
    date,
    invoiceNumber,
    notes,
    attachment,
  });

  const onSaveDraft = () => {
    saveDraft(customer.id, currentDraft());
    Alert.alert('Draft saved', 'You can finish this credit entry later.');
    navigation.goBack();
  };

  const onDiscardDraft = () => {
    clearDraft(customer.id);
    setAmount(NaN);
    setDate(toISODate(new Date()));
    setInvoiceNumber('');
    setNotes('');
    setAttachment(null);
    setRestored(false);
  };

  const onSubmit = () => {
    if (Number.isNaN(amount) || amount <= 0) {
      setError('Enter an amount greater than ₹0');
      return;
    }
    addCredit.mutate(
      {
        amount,
        date,
        invoiceNumber: invoiceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        attachment,
      },
      {
        onSuccess: () => {
          clearDraft(customer.id);
          setSuccess(true);
        },
        onError: err => Alert.alert('Could not add credit', err.message),
      },
    );
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">Add credit · Udhaar</Text>
        <Text variant="subtitle" className="mt-1">
          For {customer.fullName}
          {customer.businessName ? ` · ${customer.businessName}` : ''}
        </Text>

        {restored ? (
          <View className="mt-4 flex-row items-center justify-between rounded-xl bg-primary/5 px-4 py-3">
            <Text className="text-sm font-medium text-primary">
              Draft restored
            </Text>
            <Pressable onPress={onDiscardDraft}>
              <Text className="text-sm font-semibold text-danger">Discard</Text>
            </Pressable>
          </View>
        ) : null}

        {!online ? (
          <View className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-medium text-amber-700">
              You're offline — this credit is saved on-device and syncs later.
            </Text>
          </View>
        ) : null}

        {/* Large amount field */}
        <View className="mt-6 rounded-3xl bg-slate-900 px-5 pb-6 pt-5">
          <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Credit amount
          </Text>
          <View className="mt-3">
            <AmountInput
              value={amount}
              onChange={value => {
                setAmount(value);
                if (error) setError(null);
              }}
              error={error}
              autoFocus
            />
          </View>
          {error ? (
            <Text className="mt-2 text-xs text-red-300">{error}</Text>
          ) : null}

          {/* Quick amount buttons */}
          <View className="mt-4 flex-row" style={{gap: 8}}>
            {QUICK_AMOUNTS.map(value => (
              <Pressable
                key={value}
                onPress={() => addQuick(value)}
                className="flex-1 items-center rounded-xl border border-white/15 bg-white/5 py-2.5">
                <Text className="text-sm font-semibold text-white">
                  {formatINR(value)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Details */}
        <View className="mt-6" style={{gap: 18}}>
          <FormField label="Date" required>
            <DateField value={date} onChange={setDate} />
          </FormField>

          <FormField label="Invoice number" hint="Optional">
            <TextField
              value={invoiceNumber}
              onChangeText={v => setInvoiceNumber(v.toUpperCase())}
              placeholder="e.g. INV-1042"
              autoCapitalize="characters"
              maxLength={40}
            />
          </FormField>

          <FormField label="Notes" hint="Optional">
            <NotesInput
              value={notes}
              onChange={setNotes}
              placeholder="e.g. 2 bags cement, 1 box tiles"
              maxLength={200}
            />
          </FormField>

          <FormField label="Attachment" hint="Bill / receipt (camera or gallery)">
            <AttachmentPicker value={attachment} onChange={setAttachment} />
          </FormField>
        </View>

        <Button
          title="Add credit"
          className="mt-8"
          loading={addCredit.isPending}
          onPress={onSubmit}
        />
        <Button
          title="Save as draft"
          variant="secondary"
          className="mt-2"
          onPress={onSaveDraft}
        />
      </View>

      <SuccessOverlay
        visible={success}
        title={`${formatINR(Number.isNaN(amount) ? 0 : amount)} credit added`}
        subtitle={
          online ? 'Added to the ledger' : 'Saved — will sync when online'
        }
        onDone={() => {
          setSuccess(false);
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
