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
import {
  creditLimitStatus,
  useCreditLimit,
} from '@features/customer-intel/store/creditLimit.store';
import {useLedgerMutations} from '@features/customers/presentation/hooks';
import {useCreditDraftStore} from '@features/customers/presentation/store/creditDraft.store';
import {useConnectivity} from '@features/income/presentation/hooks';
import {useT} from '@/i18n';
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
  const t = useT();
  const {customer} = route.params;
  const online = useConnectivity();
  const creditLimit = useCreditLimit(customer.id);
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
    Alert.alert(t('customers.draftSaved'), t('customers.draftSavedMsg'));
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
      setError(t('customers.amountError'));
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
        onError: err => Alert.alert(t('customers.couldNotAddCredit'), err.message),
      },
    );
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('customers.addCreditTitle')}</Text>
        <Text variant="subtitle" className="mt-1">
          {t('customers.forCustomer', {name: customer.fullName})}
          {customer.businessName ? ` · ${customer.businessName}` : ''}
        </Text>

        {restored ? (
          <View className="mt-4 flex-row items-center justify-between rounded-xl bg-primary/5 px-4 py-3">
            <Text className="text-sm font-medium text-primary">
              {t('customers.draftRestored')}
            </Text>
            <Pressable onPress={onDiscardDraft}>
              <Text className="text-sm font-semibold text-danger">
                {t('customers.discard')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {!online ? (
          <View className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-medium text-amber-700">
              {t('customers.offlineCredit')}
            </Text>
          </View>
        ) : null}

        {(() => {
          const projected =
            customer.outstandingAmount + (Number.isNaN(amount) ? 0 : amount);
          const info = creditLimitStatus(projected, creditLimit);
          if (info.status === 'ok') return null;
          return (
            <View
              className={`mt-4 rounded-xl px-4 py-3 ${
                info.status === 'exceeded' ? 'bg-red-50' : 'bg-amber-50'
              }`}>
              <Text
                className={`text-sm font-medium ${
                  info.status === 'exceeded' ? 'text-danger' : 'text-amber-800'
                }`}>
                {info.status === 'exceeded'
                  ? t('customers.willExceed', {amount: formatINR(info.over)})
                  : t('customers.nearsLimit', {
                      amount: formatINR(creditLimit ?? 0),
                    })}
              </Text>
            </View>
          );
        })()}

        {/* Large amount field */}
        <View className="mt-6 rounded-3xl bg-slate-900 px-5 pb-6 pt-5">
          <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {t('customers.creditAmount')}
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
          <FormField label={t('form.date')} required>
            <DateField value={date} onChange={setDate} />
          </FormField>

          <FormField label={t('customers.invoiceNumber')} hint={t('common.optional')}>
            <TextField
              value={invoiceNumber}
              onChangeText={v => setInvoiceNumber(v.toUpperCase())}
              placeholder={t('customers.invoicePlaceholder')}
              autoCapitalize="characters"
              maxLength={40}
            />
          </FormField>

          <FormField label={t('form.notes')} hint={t('common.optional')}>
            <NotesInput
              value={notes}
              onChange={setNotes}
              placeholder={t('customers.creditNotesPlaceholder')}
              maxLength={200}
            />
          </FormField>

          <FormField label={t('form.attachment')} hint={t('customers.attachmentHint')}>
            <AttachmentPicker value={attachment} onChange={setAttachment} />
          </FormField>
        </View>

        <Button
          title={t('customers.addCredit')}
          className="mt-8"
          loading={addCredit.isPending}
          onPress={onSubmit}
        />
        <Button
          title={t('customers.saveDraft')}
          variant="secondary"
          className="mt-2"
          onPress={onSaveDraft}
        />
      </View>

      <SuccessOverlay
        visible={success}
        title={t('customers.creditAdded', {
          amount: formatINR(Number.isNaN(amount) ? 0 : amount),
        })}
        subtitle={
          online
            ? t('customers.addedToLedger')
            : t('customers.savedWillSync')
        }
        onDone={() => {
          setSuccess(false);
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
