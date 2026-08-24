import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, TextInput, View} from 'react-native';

import {AmountInput, DateField, FormField, TextField} from '@components/form';
import {Button, Screen, SegmentedControl, Text} from '@components/ui';
import {saveParsedTransaction} from '@features/ai-entry/domain/saveTransaction';
import type {
  ParsedTransaction,
  ParsedType,
} from '@features/ai-entry/domain/entities';
import {useParseTransaction} from '@features/ai-entry/presentation/hooks/useParseTransaction';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {toISODate} from '@utils/date';

const EXAMPLES = [
  'Ramesh ko 2500 ka maal diya',
  'Suresh se teen hazaar mile',
  'Priya ko 500 udhaar diya',
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onParse = () => {
    if (!text.trim()) return;
    setError(null);
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

  const onConfirm = async () => {
    if (!name.trim()) return setError('Enter the customer name');
    if (Number.isNaN(amount) || amount <= 0) return setError('Enter an amount');
    setError(null);
    setSaving(true);
    try {
      const customer = await saveParsedTransaction({
        customerName: name.trim(),
        type,
        amount,
        date,
        notes: parsed ? `Voice: ${parsed.rawText}` : undefined,
      });
      setSaving(false);
      Alert.alert(
        type === 'credit' ? 'Credit added' : 'Payment recorded',
        `${type === 'credit' ? 'Udhaar' : 'Payment'} of ₹${amount} saved for ${customer.fullName}.`,
        [
          {
            text: 'View customer',
            onPress: () => navigation.replace('CustomerProfile', {customer}),
          },
          {text: 'Done', style: 'cancel', onPress: () => navigation.goBack()},
        ],
      );
    } catch (e) {
      setSaving(false);
      Alert.alert(
        'Could not save',
        e instanceof Error ? e.message : 'Check your connection and try again.',
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

          {/* Review */}
          {parsed ? (
            <View className="mt-6 rounded-2xl border border-border bg-white p-4">
              <View className="mb-3 flex-row items-center justify-between">
                <Text variant="label">Review & confirm</Text>
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

                <FormField label="Date">
                  <DateField value={date} onChange={setDate} />
                </FormField>
              </View>

              {error ? (
                <Text className="mt-3 text-sm text-danger">{error}</Text>
              ) : null}

              <Button
                title="Confirm & save"
                className="mt-5"
                loading={saving}
                onPress={onConfirm}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
