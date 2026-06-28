import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {AmountInput, DateField, FormField, NotesInput, TextField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import {
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from '@features/customers/domain/ledger';
import {formatINR} from '@utils/currency';
import {toISODate} from '@utils/date';

export interface ReceivePaymentInput {
  amount: number;
  date: string;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
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

const METHODS: PaymentMethod[] = ['cash', 'upi', 'bank', 'cheque'];

/** Reference label/placeholder per method. */
const REFERENCE_HINT: Record<PaymentMethod, string> = {
  cash: 'Reference (optional)',
  upi: 'UPI transaction ID',
  bank: 'Bank reference / UTR',
  cheque: 'Cheque number',
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
  const [date, setDate] = useState<string>(toISODate(new Date()));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setAmount(NaN);
      setMethod('upi');
      setDate(toISODate(new Date()));
      setReference('');
      setNotes('');
      setError(null);
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
      setError('Enter an amount greater than ₹0');
      return;
    }
    onSubmit({
      amount,
      date,
      paymentMethod: method,
      referenceNumber: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Receive payment"
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
              Outstanding
            </Text>
            <Text className="mt-1 text-lg font-bold text-white">
              {formatINR(outstanding)}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-[11px] uppercase text-slate-400">
              {overpay > 0 ? 'Overpayment' : 'Remaining after'}
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
              Pay full · {formatINR(outstanding)}
            </Text>
          </Pressable>
        ) : null}

        {offline ? (
          <View className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5">
            <Text className="text-xs font-medium text-amber-700">
              Offline — saved on-device and synced later.
            </Text>
          </View>
        ) : null}

        <View className="mt-4" style={{gap: 16}}>
          <FormField label="Amount received" required error={error}>
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

          <FormField label="Payment method" required>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {METHODS.map(m => (
                <FilterChip
                  key={m}
                  label={PAYMENT_METHOD_LABEL[m]}
                  selected={method === m}
                  onPress={() => setMethod(m)}
                />
              ))}
            </View>
          </FormField>

          <FormField label="Date" required>
            <DateField value={date} onChange={setDate} />
          </FormField>

          <FormField
            label="Reference number"
            hint={method === 'cash' ? 'Optional' : undefined}>
            <TextField
              value={reference}
              onChangeText={setReference}
              placeholder={REFERENCE_HINT[method]}
              autoCapitalize="characters"
              maxLength={40}
            />
          </FormField>

          <FormField label="Notes" hint="Optional">
            <NotesInput
              value={notes}
              onChange={setNotes}
              placeholder="e.g. part payment"
              maxLength={200}
            />
          </FormField>
        </View>
      </ScrollView>

      <View className="border-t border-border px-5 py-3">
        <Button
          title={`Receive ${formatINR(entered)}`}
          loading={submitting}
          onPress={submit}
        />
      </View>
    </BottomSheet>
  );
}
