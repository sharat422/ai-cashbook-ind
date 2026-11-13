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
import {Button, SegmentedControl, Screen, SuccessOverlay, Text} from '@components/ui';
import type {Attachment} from '@/shared/types/attachment';
import {creditLimitStatus} from '@features/customer-intel/store/creditLimit.store';
import {useLedgerMutations} from '@features/customers/presentation/hooks';
import {useCreditDraftStore} from '@features/customers/presentation/store/creditDraft.store';
import {cleanGstin, gstInputError, type GstField} from '@features/gst/domain/gst';
import {
  GstInvoiceSection,
  emptyGstForm,
  type GstForm,
} from '@features/gst/presentation/GstInvoiceSection';
import {useConnectivity} from '@features/income/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {formatINR} from '@utils/currency';
import {todayIST} from '@utils/date';

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
  const {customer, beatId} = route.params;
  const online = useConnectivity();
  const creditLimit = customer.creditLimit;
  const {addCredit} = useLedgerMutations(customer.id);
  const saveDraft = useCreditDraftStore(s => s.saveDraft);
  const clearDraft = useCreditDraftStore(s => s.clearDraft);

  const [amount, setAmount] = useState<number>(NaN);
  // 'item': filled from the GST item's price × quantity; 'typed': the owner's own
  // figure, which an item or quantity change never overwrites.
  const [amountSource, setAmountSource] = useState<'item' | 'typed' | null>(null);
  const [date, setDate] = useState<string>(todayIST());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [success, setSuccess] = useState(false);
  // GST invoice: only for a GST-registered business; null = a plain credit.
  const gstRegistered = useAuthStore(s => s.business?.gstRegistered ?? false);
  const hasSellerGstin = useAuthStore(s => !!s.business?.gstin);
  const [gst, setGst] = useState<GstForm | null>(null);
  const [gstError, setGstError] = useState<{field: GstField; message: string} | null>(null);

  // Restore a saved draft for this customer on first mount.
  useEffect(() => {
    const draft = useCreditDraftStore.getState().drafts[customer.id];
    if (draft) {
      setAmount(draft.amount);
      if (!Number.isNaN(draft.amount)) setAmountSource('typed');
      setDate(draft.date);
      setInvoiceNumber(draft.invoiceNumber);
      setNotes(draft.notes);
      setAttachment(draft.attachment);
      setGst(draft.gst ?? null);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addQuick = (value: number) => {
    setAmount(prev => (Number.isNaN(prev) ? 0 : prev) + value);
    setAmountSource('typed');
    if (error) setError(null);
  };

  const currentDraft = () => ({
    amount,
    date,
    invoiceNumber,
    notes,
    attachment,
    gst,
  });

  const onSaveDraft = () => {
    saveDraft(customer.id, currentDraft());
    Alert.alert(t('customers.draftSaved'), t('customers.draftSavedMsg'));
    navigation.goBack();
  };

  const onDiscardDraft = () => {
    clearDraft(customer.id);
    setAmount(NaN);
    setAmountSource(null);
    setDate(todayIST());
    setInvoiceNumber('');
    setNotes('');
    setAttachment(null);
    setGst(null);
    setRestored(false);
  };

  const onSubmit = (asDraft = false) => {
    if (Number.isNaN(amount) || amount <= 0) {
      setError(t('customers.amountError'));
      return;
    }
    const gstin = gst ? cleanGstin(gst.customerGstin) : '';
    const gstInput = gst
      ? {
          rate: gst.rate,
          hsn: gst.hsn,
          quantity: gst.quantity,
          uqc: gst.uqc ?? '',
          priceIncludesGst: gst.priceIncludesGst,
          customerGstin: gstin || undefined,
          placeOfSupply: gstin ? undefined : gst.placeOfSupply ?? undefined,
          paidNow: gst.paidNow || undefined,
          draft: asDraft || undefined,
        }
      : undefined;
    const problem = gstInput ? gstInputError(gstInput) : null;
    setGstError(problem);
    if (problem) return;
    addCredit.mutate(
      {
        amount,
        date,
        invoiceNumber: invoiceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        attachment,
        beatId,
        gst: gstInput,
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
                setAmountSource('typed');
                if (error) setError(null);
              }}
              error={error}
              autoFocus
            />
          </View>
          {error ? (
            <Text className="mt-2 text-xs text-red-300">{error}</Text>
          ) : null}
          {gst && amountSource === 'item' ? (
            <Text testID="amount-from-item" className="mt-2 text-xs text-amber-300">{t('gst.amountFromItem')}</Text>
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

          {gstRegistered && !hasSellerGstin ? (
            <Text testID="gst-needs-gstin" variant="caption">{t('gst.needsSellerGstin')}</Text>
          ) : gstRegistered ? (
            <SegmentedControl
              label={t('gst.invoiceToggle')}
              value={gst !== null}
              options={[
                {label: t('common.no'), value: false},
                {label: t('common.yes'), value: true},
              ]}
              onChange={on => {
                setGst(on ? emptyGstForm(customer.gstNumber) : null);
                setGstError(null);
              }}
            />
          ) : null}

          {gst ? (
            // Rule 46: consecutive and unique per financial year, so the server numbers it.
            <Text testID="gst-invoice-auto" variant="caption">{t('gst.invoiceAuto')}</Text>
          ) : (
            <FormField label={t('customers.invoiceNumber')} hint={t('common.optional')}>
              <TextField
                value={invoiceNumber}
                onChangeText={v => setInvoiceNumber(v.toUpperCase())}
                placeholder={t('customers.invoicePlaceholder')}
                autoCapitalize="characters"
                maxLength={40}
              />
            </FormField>
          )}

          {gst ? (
            <GstInvoiceSection
              value={gst}
              onChange={setGst}
              amount={amount}
              onItemAmount={v => {
                if (amountSource === 'typed') return; // never overwrite the owner's figure
                setAmount(v);
                setAmountSource('item');
                if (error) setError(null);
              }}
              online={online}
              errorField={gstError?.field}
              error={gstError?.message}
            />
          ) : null}

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
          onPress={() => onSubmit()}
        />
        {gst && !gst.paidNow ? (
          <Button
            testID="gst-save-draft"
            title={t('gst.saveAsDraft')}
            variant="secondary"
            className="mt-3"
            disabled={addCredit.isPending}
            onPress={() => onSubmit(true)}
          />
        ) : null}
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
