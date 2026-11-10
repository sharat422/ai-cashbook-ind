import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {AmountInput, DateField, FormField, NotesInput, TextField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import {
  isUtrMissing,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@features/customers/domain/ledger';
import {useT, type TKey} from '@/i18n';
import {paymentMethodLabel} from '@/i18n/labels';
import {formatINR} from '@utils/currency';
import {todayIST} from '@utils/date';

export interface ReceivePaymentInput {
  amount: number;
  date: string;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  chequeBank?: string;
  chequeAccount?: string;
  notes?: string;
}

export interface ReceivePaymentSheetProps {
  visible: boolean;
  /** Current outstanding, to auto-calculate the remaining balance. */
  outstanding: number;
  submitting?: boolean;
  offline?: boolean;
  onClose: () => void;
  onSubmit: (input: ReceivePaymentInput) => void;
}

const METHODS = PAYMENT_METHODS;

/** Reference label/placeholder per method. */
const REFERENCE_HINT: Record<PaymentMethod, TKey> = {
  cash: 'payments.refOptional',
  upi: 'payments.refUpi',
  bank: 'payments.refBank',
  card: 'payments.refCard',
  cheque: 'payments.refCheque',
  credit: 'payments.refOptional',
  other: 'payments.refOptional',
};

/**
 * Modern bottom-sheet for recording a received payment. Live remaining-balance,
 * method selector, validation, and offline awareness.
 */
export function ReceivePaymentSheet({
  visible,
  outstanding,
  submitting,
  offline,
  onClose,
  onSubmit,
}: ReceivePaymentSheetProps): React.JSX.Element {
  const [amount, setAmount] = useState<number>(NaN);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [date, setDate] = useState<string>(todayIST());
  const [reference, setReference] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeAccount, setChequeAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    if (visible) {
      setAmount(NaN);
      setMethod('upi');
      setDate(todayIST());
      setReference('');
      setChequeBank('');
      setChequeAccount('');
      setNotes('');
      setError(null);
      setRefError(null);
    }
  }, [visible]);

  const entered = Number.isNaN(amount) ? 0 : amount;
  const remaining = useMemo(
    () => Math.max(0, outstanding - entered),
    [outstanding, entered],
  );
  const overpay = entered > outstanding ? entered - outstanding : 0;

  const submit = () => {
    if (Number.isNaN(amount) || amount <= 0) {
      setError(t('errors.amountPositive'));
      return;
    }
    if (isUtrMissing(method, reference)) {
      setRefError(t('payments.utrRequired'));
      return;
    }
    onSubmit({
      amount,
      date,
      paymentMethod: method,
      referenceNumber: reference.trim() || undefined,
      chequeBank: method === 'cheque' ? chequeBank.trim() || undefined : undefined,
      chequeAccount: method === 'cheque' ? chequeAccount.trim() || undefined : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('payments.title')}
      maxHeightClassName="max-h-[90%]">
      <ScrollView
        className="px-5"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 16}}>
        {/* Balance summary */}
        <View className="mt-1 flex-row rounded-2xl bg-slate-900 p-4" style={{gap: 12}}>
          <View className="flex-1">
            <Text className="text-[11px] uppercase text-slate-400">
              {t('payments.outstanding')}
            </Text>
            <Text className="mt-1 text-lg font-bold text-white">
              {formatINR(outstanding)}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-[11px] uppercase text-slate-400">
              {overpay > 0 ? t('payments.overpayment') : t('payments.remainingAfter')}
            </Text>
            <Text
              className={`mt-1 text-lg font-bold ${
                overpay > 0
                  ? 'text-amber-300'
                  : remaining === 0
                  ? 'text-green-300'
                  : 'text-white'
              }`}>
              {formatINR(overpay > 0 ? overpay : remaining)}
            </Text>
          </View>
        </View>

        {/* Quick: pay full */}
        {outstanding > 0 ? (
          <Pressable
            className="mt-2 self-start"
            onPress={() => {
              setAmount(outstanding);
              if (error) setError(null);
            }}>
            <Text className="text-sm font-semibold text-primary">
              {t('payments.payFull', {amount: formatINR(outstanding)})}
            </Text>
          </Pressable>
        ) : null}

        {offline ? (
          <View className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5">
            <Text className="text-xs font-medium text-amber-700">
              {t('payments.offline')}
            </Text>
          </View>
        ) : null}

        <View className="mt-4" style={{gap: 16}}>
          <FormField label={t('payments.amountReceived')} required error={error}>
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

          <FormField label={t('payments.method')} required>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {METHODS.map(m => (
                <FilterChip
                  key={m}
                  label={paymentMethodLabel(t, m)}
                  selected={method === m}
                  onPress={() => {
                    setMethod(m);
                    setRefError(null);
                  }}
                />
              ))}
            </View>
          </FormField>

          <FormField label={t('form.date')} required>
            <DateField value={date} onChange={setDate} />
          </FormField>

          <FormField
            label={method === 'upi' ? t('payments.utrLabel') : t('payments.reference')}
            required={method === 'upi'}
            error={refError}
            hint={method === 'cash' ? t('common.optional') : undefined}>
            <TextField
              value={reference}
              onChangeText={v => {
                setReference(v);
                if (refError) setRefError(null);
              }}
              placeholder={t(REFERENCE_HINT[method])}
              autoCapitalize="characters"
              maxLength={40}
            />
          </FormField>

          {/* A cheque number repeats across banks and accounts: these tell two apart. */}
          {method === 'cheque' ? (
            <>
              <FormField label={t('payments.chequeBank')} hint={t('common.optional')}>
                <TextField testID="cheque-bank" value={chequeBank} onChangeText={setChequeBank}
                  placeholder={t('payments.chequeBankPlaceholder')} maxLength={60} />
              </FormField>
              <FormField label={t('payments.chequeAccount')} hint={t('common.optional')}>
                <TextField testID="cheque-account" value={chequeAccount} onChangeText={setChequeAccount}
                  keyboardType="number-pad" maxLength={20} />
              </FormField>
            </>
          ) : null}

          <FormField label={t('form.notes')} hint={t('common.optional')}>
            <NotesInput
              value={notes}
              onChange={setNotes}
              placeholder={t('payments.notesPlaceholder')}
              maxLength={200}
            />
          </FormField>
        </View>
      </ScrollView>

      <View className="border-t border-border px-5 py-3">
        <Button
          title={t('payments.receive', {amount: formatINR(entered)})}
          loading={submitting}
          onPress={submit}
        />
      </View>
    </BottomSheet>
  );
}
