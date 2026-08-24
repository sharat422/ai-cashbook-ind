import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, TextInput, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {AmountInput, DateField, FormField, TextField} from '@components/form';
import {Button, Screen, SegmentedControl, Text} from '@components/ui';
import type {
  ParsedTransaction,
  ParsedType,
} from '@features/ai-entry/domain/entities';
import {
  addLedgerForCustomer,
  createCustomerByName,
  exactMatch,
  findCustomerCandidates,
} from '@features/ai-entry/domain/saveTransaction';
import {useParseTransaction} from '@features/ai-entry/presentation/hooks/useParseTransaction';
import type {Customer} from '@features/customers/domain/entities';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from '@features/customers/domain/ledger';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';
import {toISODate} from '@utils/date';

const EXAMPLES = [
  'Ramesh ko 2500 ka maal diya',
  'Suresh se teen hazaar mile',
  'gave ramesh 500 for groceries',
];

const TYPE_OPTIONS: Array<{label: string; value: ParsedType}> = [
  {label: 'Gave · Udhaar', value: 'credit'},
  {label: 'Received', value: 'payment'},
];

export function AITransactionScreen({
  navigation,
}: AppScreenProps<'AITransaction'>): React.JSX.Element {
  const parse = useParseTransaction();

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedTransaction | null>(null);
  // Editable review fields (seeded from the parse result).
  const [name, setName] = useState('');
  const [type, setType] = useState<ParsedType>('credit');
  const [amount, setAmount] = useState<number>(NaN);
  const [date, setDate] = useState<string>(toISODate(new Date()));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set, the "Which <name>?" picker is shown (multiple matches).
  const [candidates, setCandidates] = useState<Customer[] | null>(null);

  const onParse = () => {
    if (!text.trim()) return;
    setError(null);
    setCandidates(null);
    parse.mutate(
      {text: text.trim(), today: toISODate(new Date())},
      {
        onSuccess: result => {
          setParsed(result);
          setName(result.customerName ?? '');
          setType(result.type);
          setAmount(result.amount ?? NaN);
          setDate(result.date || toISODate(new Date()));
        },
        onError: err =>
          Alert.alert(
            'Could not read that',
            err instanceof Error ? err.message : 'Please try again.',
          ),
      },
    );
  };

  /** Add the entry to a resolved customer, then confirm to the user. */
  const commitTo = async (customerOrPromise: Customer | Promise<Customer>) => {
    setBusy(true);
    setCandidates(null);
    try {
      const customer = await customerOrPromise;
      await addLedgerForCustomer(customer.id, {
        type,
        amount,
        date,
        paymentMethod: method,
        notes: parsed ? `Voice/AI: ${parsed.rawText}` : undefined,
      });
      setBusy(false);
      Alert.alert(
        type === 'credit' ? 'Credit added' : 'Payment recorded',
        `${type === 'credit' ? 'Udhaar' : 'Payment'} of ${formatINR(amount)} saved for ${customer.fullName}.`,
        [
          {
            text: 'View customer',
            onPress: () => navigation.replace('CustomerProfile', {customer}),
          },
          {text: 'Done', style: 'cancel', onPress: () => navigation.goBack()},
        ],
      );
    } catch (e) {
      setBusy(false);
      Alert.alert(
        'Could not save',
        e instanceof Error ? e.message : 'Check your connection and try again.',
      );
    }
  };

  const onConfirm = async () => {
    if (!name.trim()) return setError('Enter the customer name');
    if (Number.isNaN(amount) || amount <= 0) return setError('Enter an amount');
    setError(null);
    setBusy(true);
    try {
      const found = await findCustomerCandidates(name);
      setBusy(false);
      if (found.length === 0) return commitTo(createCustomerByName(name));
      const one = exactMatch(name, found);
      if (one) return commitTo(one);
      setCandidates(found); // ambiguous → ask "Which <name>?"
    } catch (e) {
      setBusy(false);
      Alert.alert(
        'Could not check customers',
        e instanceof Error ? e.message : 'Check your connection.',
      );
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="py-6">
          <Text variant="title">🎤 AI Entry</Text>
          <Text variant="subtitle" className="mt-1">
            Speak or type a transaction in your language — we’ll fill it in.
          </Text>

          {/* Input */}
          <View className="mt-5 rounded-2xl border border-border bg-white px-4 py-3">
            <TextInput
              className="min-h-[72px] p-0 text-base text-slate-900"
              value={text}
              onChangeText={setText}
              placeholder="e.g. Ramesh ko 2500 ka maal diya"
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
            />
          </View>
          <Text variant="caption" className="mt-2">
            💡 Tap the 🎤 on your keyboard and speak — Hindi, Hinglish, Telugu,
            Tamil, Kannada, Marathi, Gujarati, Bengali, Malayalam, Punjabi &
            English.
          </Text>

          {/* Examples */}
          <View className="mt-3 flex-row flex-wrap" style={{gap: 8}}>
            {EXAMPLES.map(ex => (
              <Pressable
                key={ex}
                onPress={() => setText(ex)}
                className="rounded-full border border-border bg-white px-3 py-1.5">
                <Text className="text-xs text-slate-700">{ex}</Text>
              </Pressable>
            ))}
          </View>

          <Button
            title="✨ Read transaction"
            className="mt-4"
            loading={parse.isPending}
            disabled={!text.trim()}
            onPress={onParse}
          />

          {/* Review + confirm */}
          {parsed ? (
            <View className="mt-6 rounded-2xl border border-border bg-white p-4">
              <View className="mb-3 flex-row items-center justify-between">
                <Text variant="label">I understood — confirm</Text>
                <Text variant="caption">
                  {parsed.source === 'ai' ? 'AI' : 'Basic'} ·{' '}
                  {Math.round(parsed.confidence * 100)}%
                </Text>
              </View>

              <View style={{gap: 16}}>
                <FormField label="Customer" required>
                  <TextField
                    value={name}
                    onChangeText={setName}
                    placeholder="Customer name"
                  />
                </FormField>

                <FormField label="Type">
                  <SegmentedControl
                    value={type}
                    options={TYPE_OPTIONS}
                    onChange={setType}
                  />
                </FormField>

                <FormField label="Amount" required>
                  <AmountInput value={amount} onChange={setAmount} />
                </FormField>

                {type === 'payment' ? (
                  <FormField label="Payment method">
                    <View className="flex-row flex-wrap" style={{gap: 8}}>
                      {PAYMENT_METHODS.map(m => (
                        <FilterChip
                          key={m}
                          label={PAYMENT_METHOD_LABEL[m]}
                          selected={method === m}
                          onPress={() => setMethod(m)}
                        />
                      ))}
                    </View>
                  </FormField>
                ) : null}

                <FormField label="Date">
                  <DateField value={date} onChange={setDate} />
                </FormField>
              </View>

              {error ? (
                <Text className="mt-3 text-sm text-danger">{error}</Text>
              ) : null}

              {/* Disambiguation picker OR confirm button */}
              {candidates ? (
                <View className="mt-5 border-t border-border pt-4">
                  <Text variant="label">Which “{name.trim()}”?</Text>
                  <Text variant="caption" className="mb-3 mt-1">
                    More than one customer matches — pick one, or create new.
                  </Text>
                  <View style={{gap: 8}}>
                    {candidates.map(c => (
                      <Pressable
                        key={c.id}
                        onPress={() => commitTo(c)}
                        className="flex-row items-center justify-between rounded-xl border border-border px-4 py-3">
                        <View className="flex-1 pr-3">
                          <Text className="font-semibold text-slate-900">
                            {c.fullName}
                          </Text>
                          <Text variant="caption">
                            {c.businessName ? `${c.businessName} · ` : ''}+91{' '}
                            {c.mobile || '—'}
                          </Text>
                        </View>
                        <Text className="text-sm font-semibold text-slate-900">
                          {formatINR(c.outstandingAmount)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Button
                    title={`➕ Create new “${name.trim()}”`}
                    variant="secondary"
                    className="mt-3"
                    loading={busy}
                    onPress={() => commitTo(createCustomerByName(name))}
                  />
                  <Button
                    title="Cancel"
                    variant="ghost"
                    className="mt-1"
                    onPress={() => setCandidates(null)}
                  />
                </View>
              ) : (
                <Button
                  title="Confirm & save"
                  className="mt-5"
                  loading={busy}
                  onPress={onConfirm}
                />
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
