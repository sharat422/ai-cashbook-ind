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
import {
  useParseTransaction,
  useVoiceParse,
} from '@features/ai-entry/presentation/hooks/useParseTransaction';
import {
  ensureMicPermission,
  startRecording,
  stopRecording,
} from '@features/ai-entry/data/voiceRecorder';
import type {Customer} from '@features/customers/domain/entities';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from '@features/customers/domain/ledger';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';
import {toISODate} from '@utils/date';

export function AITransactionScreen({
  navigation,
}: AppScreenProps<'AITransaction'>): React.JSX.Element {
  const t = useT();
  const parse = useParseTransaction();
  const voice = useVoiceParse();
  const [recording, setRecording] = useState(false);

  const EXAMPLES = [t('ai.example1'), t('ai.example2'), t('ai.example3')];
  const TYPE_OPTIONS: Array<{label: string; value: ParsedType}> = [
    {label: t('ai.typeCredit'), value: 'credit'},
    {label: t('ai.typeReceived'), value: 'payment'},
  ];

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

  /** Seed the editable review fields from a parse result (text or voice). */
  const applyParsed = (result: ParsedTransaction) => {
    setParsed(result);
    setName(result.customerName ?? '');
    setType(result.type);
    setAmount(result.amount ?? NaN);
    setDate(result.date || toISODate(new Date()));
  };

  /** Mic: tap to record, tap again to stop → transcribe (any language) + parse. */
  const onMic = async () => {
    if (voice.isPending) return;
    if (recording) {
      let audio;
      try {
        audio = await stopRecording();
      } catch {
        setRecording(false);
        return Alert.alert(t('ai.couldNotRead'), t('ai.tryAgain'));
      }
      setRecording(false);
      setError(null);
      setCandidates(null);
      voice.mutate(
        {audio, today: toISODate(new Date())},
        {
          onSuccess: result => {
            setText(result.transcript); // show what was heard
            applyParsed(result);
          },
          onError: err =>
            Alert.alert(
              t('ai.couldNotRead'),
              err instanceof Error ? err.message : t('ai.tryAgain'),
            ),
        },
      );
      return;
    }
    if (!(await ensureMicPermission())) {
      return Alert.alert(t('ai.micNeededTitle'), t('ai.micNeededMsg'));
    }
    try {
      await startRecording();
      setRecording(true);
    } catch {
      Alert.alert(t('ai.couldNotRead'), t('ai.tryAgain'));
    }
  };

  const onParse = () => {
    if (!text.trim()) return;
    setError(null);
    setCandidates(null);
    parse.mutate(
      {text: text.trim(), today: toISODate(new Date())},
      {
        onSuccess: applyParsed,
        onError: err =>
          Alert.alert(
            t('ai.couldNotRead'),
            err instanceof Error ? err.message : t('ai.tryAgain'),
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
        type === 'credit'
          ? t('ai.creditAddedTitle')
          : t('ai.paymentRecordedTitle'),
        type === 'credit'
          ? t('ai.savedCreditMsg', {
              amount: formatINR(amount),
              customer: customer.fullName,
            })
          : t('ai.savedPaymentMsg', {
              amount: formatINR(amount),
              customer: customer.fullName,
            }),
        [
          {
            text: t('ai.viewCustomer'),
            onPress: () => navigation.replace('CustomerProfile', {customer}),
          },
          {
            text: t('common.done'),
            style: 'cancel',
            onPress: () => navigation.goBack(),
          },
        ],
      );
    } catch (e) {
      setBusy(false);
      Alert.alert(
        t('form.couldNotSave'),
        e instanceof Error ? e.message : t('ai.checkConnection'),
      );
    }
  };

  const onConfirm = async () => {
    if (!name.trim()) return setError(t('ai.enterName'));
    if (Number.isNaN(amount) || amount <= 0) return setError(t('ai.enterAmount'));
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
        t('ai.couldNotCheck'),
        e instanceof Error ? e.message : t('ai.checkConnection'),
      );
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="py-6">
          <Text variant="title">{t('ai.title')}</Text>
          <Text variant="subtitle" className="mt-1">
            {t('ai.subtitle')}
          </Text>

          {/* Mic — speak in any language; the server transcribes + parses */}
          <Pressable
            accessibilityRole="button"
            onPress={onMic}
            disabled={voice.isPending}
            className={`mt-5 flex-row items-center justify-center rounded-2xl px-4 py-4 ${
              recording ? 'bg-danger' : 'bg-primary'
            }`}
            style={{gap: 10, opacity: voice.isPending ? 0.6 : 1}}>
            <Text className="text-2xl">{recording ? '⏹' : '🎤'}</Text>
            <Text className="text-base font-semibold text-white">
              {voice.isPending
                ? t('ai.transcribing')
                : recording
                ? t('ai.listening')
                : t('ai.speak')}
            </Text>
          </Pressable>

          {/* Input */}
          <View className="mt-3 rounded-2xl border border-border bg-white px-4 py-3">
            <TextInput
              className="min-h-[72px] p-0 text-base text-slate-900"
              value={text}
              onChangeText={setText}
              placeholder={t('ai.inputPlaceholder')}
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
            />
          </View>
          <Text variant="caption" className="mt-2">
            {t('ai.hint')}
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
            title={t('ai.read')}
            className="mt-4"
            loading={parse.isPending}
            disabled={!text.trim()}
            onPress={onParse}
          />

          {/* Review + confirm */}
          {parsed ? (
            <View className="mt-6 rounded-2xl border border-border bg-white p-4">
              <View className="mb-3 flex-row items-center justify-between">
                <Text variant="label">{t('ai.confirmHeader')}</Text>
                <Text variant="caption">
                  {parsed.source === 'ai' ? t('ai.sourceAI') : t('ai.sourceBasic')}{' '}
                  · {Math.round(parsed.confidence * 100)}%
                </Text>
              </View>

              <View style={{gap: 16}}>
                <FormField label={t('ai.customer')} required>
                  <TextField
                    value={name}
                    onChangeText={setName}
                    placeholder={t('ai.customerPlaceholder')}
                  />
                </FormField>

                <FormField label={t('ai.type')}>
                  <SegmentedControl
                    value={type}
                    options={TYPE_OPTIONS}
                    onChange={setType}
                  />
                </FormField>

                <FormField label={t('form.amount')} required>
                  <AmountInput value={amount} onChange={setAmount} />
                </FormField>

                {type === 'payment' ? (
                  <FormField label={t('ai.paymentMethod')}>
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

                <FormField label={t('form.date')}>
                  <DateField value={date} onChange={setDate} />
                </FormField>
              </View>

              {error ? (
                <Text className="mt-3 text-sm text-danger">{error}</Text>
              ) : null}

              {/* Disambiguation picker OR confirm button */}
              {candidates ? (
                <View className="mt-5 border-t border-border pt-4">
                  <Text variant="label">
                    {t('ai.whichName', {name: name.trim()})}
                  </Text>
                  <Text variant="caption" className="mb-3 mt-1">
                    {t('ai.whichNameHint')}
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
                    title={t('ai.createNew', {name: name.trim()})}
                    variant="secondary"
                    className="mt-3"
                    loading={busy}
                    onPress={() => commitTo(createCustomerByName(name))}
                  />
                  <Button
                    title={t('common.cancel')}
                    variant="ghost"
                    className="mt-1"
                    onPress={() => setCandidates(null)}
                  />
                </View>
              ) : (
                <Button
                  title={t('ai.confirmSave')}
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
