import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {AmountInput, DateField, FormField, NotesInput, TextField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import {BeatPicker} from '@features/beats/presentation/components/BeatPicker';
import {splitPayment, type Bill, type BillAllocation} from '@features/customers/domain/bills';
import {billLabel, useCustomerBills} from '@features/customers/presentation/hooks/useCustomerBills';
import {
  isUtrMissing,
  PAYMENT_METHODS,
  type PaymentMethod,
  UTR_LENGTH,
  utrDigits,
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
  /** The beat it counts for (its ledger and daily close). */
  beatId?: string;
  /** The bills it pays, oldest first as picked (none = not linked to a bill). */
  allocations?: BillAllocation[];
}

export interface ReceivePaymentSheetProps {
  visible: boolean;
  /** Current outstanding, to auto-calculate the remaining balance. */
  outstanding: number;
  submitting?: boolean;
  offline?: boolean;
  onClose: () => void;
  onSubmit: (input: ReceivePaymentInput) => void;
  /** Whose payment: offers their open bills, and a beat picker (the customer's beats). */
  customerId?: string;
  /** Collected on this beat (a beat day-list): no beat picker; the bills are read through it (staff). */
  dayBeatId?: string;
  /** The amount to start with (a promise to pay's); empty otherwise. */
  initialAmount?: number;
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
  customerId,
  dayBeatId,
  initialAmount,
}: ReceivePaymentSheetProps): React.JSX.Element {
  const [amount, setAmount] = useState<number>(NaN);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [date, setDate] = useState<string>(todayIST());
  const [reference, setReference] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeAccount, setChequeAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [beatId, setBeatId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());
  const t = useT();
  // Open bills, oldest first; the payment goes on them in order unless one is left out.
  const billsQuery = useCustomerBills(customerId, dayBeatId, visible);
  const openBills = (billsQuery.data?.bills ?? []).filter((b: Bill) => b.left > 0);

  useEffect(() => {
    if (visible) {
      setAmount(initialAmount ?? NaN);
      setMethod('upi');
      setDate(todayIST());
      setReference('');
      setChequeBank('');
      setChequeAccount('');
      setNotes('');
      setBeatId(undefined);
      setError(null);
      setRefError(null);
      setSkip(new Set());
    }
  }, [visible]);

  const entered = Number.isNaN(amount) ? 0 : amount;
  const remaining = useMemo(
    () => Math.max(0, outstanding - entered),
    [outstanding, entered],
  );
  const overpay = entered > outstanding ? entered - outstanding : 0;
  const {split, extra} = splitPayment(openBills, entered, skip);
  const toggle = (id: string) =>
    setSkip(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
      beatId,
      allocations: split.length ? split : undefined,
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

          {openBills.length ? (
            <FormField label={t('payments.billsTitle')} hint={t('payments.billsHint')}>
              <View style={{gap: 8}}>
                {openBills.map((b: Bill) => {
                  const on = !skip.has(b.id);
                  const gets = split.find(s => s.billId === b.id)?.amount ?? 0;
                  return (
                    <Pressable
                      key={b.id}
                      testID={`pay-bill-${b.id}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{checked: on}}
                      onPress={() => toggle(b.id)}
                      className={`flex-row items-center rounded-xl border px-3 py-2.5 ${
                        on ? 'border-green-300 bg-green-50' : 'border-border bg-white'
                      }`}>
                      <View className="flex-1 pr-2">
                        <Text className={`text-sm font-semibold ${on ? 'text-slate-900' : 'text-muted'}`}>
                          {billLabel(t, b)}
                        </Text>
                        <Text variant="caption">
                          {t('payments.billLeft', {left: formatINR(b.left), amount: formatINR(b.amount)})}
                        </Text>
                      </View>
                      {gets > 0 ? (
                        <Text testID={`pay-bill-gets-${b.id}`} className="text-sm font-bold text-success">
                          {formatINR(gets)}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
                {extra > 0 ? (
                  <Text testID="pay-unlinked" variant="caption">
                    {t('payments.unlinkedExtra', {amount: formatINR(extra)})}
                  </Text>
                ) : null}
              </View>
            </FormField>
          ) : null}

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

          {customerId && !dayBeatId ? <BeatPicker customerId={customerId} value={beatId} onChange={setBeatId} /> : null}

          <FormField
            label={method === 'upi' ? t('payments.utrLabel') : t('payments.reference')}
            required={method === 'upi'}
            error={refError}
            hint={method === 'cash' ? t('common.optional') : undefined}>
            <TextField
              value={reference}
              onChangeText={v => {
                setReference(method === 'upi' ? utrDigits(v) : v);
                if (refError) setRefError(null);
              }}
              placeholder={t(REFERENCE_HINT[method])}
              autoCapitalize="characters"
              keyboardType={method === 'upi' ? 'number-pad' : 'default'}
              maxLength={method === 'upi' ? UTR_LENGTH : 40}
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
