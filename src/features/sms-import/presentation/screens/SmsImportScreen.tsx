import React, {useState} from 'react';
import {Alert, Linking, Pressable, ScrollView, TextInput, View} from 'react-native';

import {AmountInput, DateField, FormField, TextField} from '@components/form';
import {
  Button,
  EmptyState,
  Screen,
  SegmentedControl,
  Select,
  Text,
} from '@components/ui';
import {EXPENSE_CATEGORIES} from '@features/expense/domain/entities';
import {useCreateExpense} from '@features/expense/presentation/hooks';
import {INCOME_CATEGORIES} from '@features/income/domain/entities';
import {useCreateIncome} from '@features/income/presentation/hooks';
import {parseBankSms, type ParsedBankSms} from '@features/sms-import/domain/bankSms';
import {
  isSmsScanSupported,
  requestSmsPermission,
  scanBankSms,
} from '@features/sms-import/data/smsReader';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {toISODate} from '@utils/date';

type Kind = 'expense' | 'income';

interface Candidate {
  id: string;
  kind: Kind;
  amount: number;
  /** Payee (debit) or payer (credit) — becomes the expense vendor / a note. */
  party: string;
  date: string;
  category: string;
  rawText: string;
  saved: boolean;
}

const KIND_OPTIONS = [
  {label: '− Expense', value: 'expense' as Kind},
  {label: '+ Income', value: 'income' as Kind},
];

let seq = 0;
function toCandidate(p: ParsedBankSms): Candidate {
  const kind: Kind = p.direction === 'credit' ? 'income' : 'expense';
  return {
    id: `sms-${seq++}`,
    kind,
    amount: p.amount,
    party: p.merchant ?? '',
    date: p.date ?? toISODate(new Date()),
    category: kind === 'income' ? 'Sales' : 'Miscellaneous',
    rawText: p.rawText,
    saved: false,
  };
}

/** De-dupe against what's already listed (same raw message). */
function mergeNew(existing: Candidate[], incoming: ParsedBankSms[]): Candidate[] {
  const seen = new Set(existing.map(c => c.rawText));
  const fresh = incoming.filter(p => !seen.has(p.rawText.trim())).map(toCandidate);
  return [...fresh, ...existing];
}

export function SmsImportScreen({
  navigation,
}: AppScreenProps<'SmsImport'>): React.JSX.Element {
  const scanSupported = isSmsScanSupported();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [scanning, setScanning] = useState(false);

  const onScan = async () => {
    const perm = await requestSmsPermission();
    if (perm === 'blocked') {
      Alert.alert(
        'Permission needed',
        'SMS access is turned off. Enable it in Settings to scan bank messages.',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Open Settings', onPress: () => Linking.openSettings()},
        ],
      );
      return;
    }
    if (perm !== 'granted') return; // denied / unsupported → silently no-op

    setScanning(true);
    try {
      const {parsed} = await scanBankSms({maxCount: 200, sinceDays: 90});
      setCandidates(prev => mergeNew(prev, parsed));
      if (parsed.length === 0) {
        Alert.alert(
          'No transactions found',
          'No bank transaction messages were found in your recent SMS.',
        );
      }
    } catch (e) {
      Alert.alert(
        'Could not read messages',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setScanning(false);
    }
  };

  const onDetectPaste = () => {
    const parsed = parseBankSms(pasteText);
    if (!parsed) {
      Alert.alert(
        'Couldn’t read that',
        'That message doesn’t look like a bank transaction. Paste the full SMS text (including the amount).',
      );
      return;
    }
    setCandidates(prev => mergeNew(prev, [parsed]));
    setPasteText('');
  };

  const update = (id: string, patch: Partial<Candidate>) =>
    setCandidates(prev => prev.map(c => (c.id === id ? {...c, ...patch} : c)));

  const remove = (id: string) =>
    setCandidates(prev => prev.filter(c => c.id !== id));

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}>
        <Text variant="title">Import from SMS</Text>
        <Text variant="subtitle" className="mt-0.5">
          Turn bank transaction messages into entries — you review and confirm
          each one before it’s saved.
        </Text>

        {/* Scan (Android) */}
        {scanSupported ? (
          <Button
            title={scanning ? 'Scanning…' : '🔍 Scan bank SMS'}
            className="mt-5"
            loading={scanning}
            onPress={onScan}
          />
        ) : (
          <View className="mt-5 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-medium text-amber-700">
              Automatic SMS scanning isn’t available on iOS. Paste a bank message
              below instead.
            </Text>
          </View>
        )}

        {/* Paste (all platforms) */}
        <View className="mt-4 rounded-2xl border border-border bg-white p-4">
          <Text variant="label" className="mb-2">
            Paste a bank SMS
          </Text>
          <TextInput
            className="min-h-[64px] rounded-xl border border-border p-3 text-sm text-slate-900"
            value={pasteText}
            onChangeText={setPasteText}
            placeholder="e.g. Rs.2500 debited from a/c XX1234 on 05-08-26 to VPA ramesh@okhdfc"
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
          />
          <Button
            title="Detect transaction"
            variant="secondary"
            className="mt-3"
            disabled={!pasteText.trim()}
            onPress={onDetectPaste}
          />
        </View>

        {/* Candidates */}
        {candidates.length === 0 ? (
          <View className="mt-8">
            <EmptyState
              icon="💬"
              title="No messages yet"
              message={
                scanSupported
                  ? 'Scan your inbox or paste a bank SMS to get started.'
                  : 'Paste a bank SMS above to get started.'
              }
            />
          </View>
        ) : (
          <View className="mt-6" style={{gap: 12}}>
            <Text variant="label">
              {candidates.filter(c => !c.saved).length} to review
            </Text>
            {candidates.map(c => (
              <CandidateCard
                key={c.id}
                candidate={c}
                onChange={patch => update(c.id, patch)}
                onSaved={() => update(c.id, {saved: true})}
                onRemove={() => remove(c.id)}
                onViewTxns={() => navigation.navigate('TransactionHistory')}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function CandidateCard({
  candidate,
  onChange,
  onSaved,
  onRemove,
  onViewTxns,
}: {
  candidate: Candidate;
  onChange: (patch: Partial<Candidate>) => void;
  onSaved: () => void;
  onRemove: () => void;
  onViewTxns: () => void;
}): React.JSX.Element {
  const createExpense = useCreateExpense();
  const createIncome = useCreateIncome();
  const saving = createExpense.isPending || createIncome.isPending;
  const {kind} = candidate;

  const onSave = () => {
    if (Number.isNaN(candidate.amount) || candidate.amount <= 0) {
      Alert.alert('Enter an amount', 'Add a valid amount before saving.');
      return;
    }
    const onError = (e: unknown) =>
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again.');
    const notes = `From SMS: ${candidate.rawText}`.slice(0, 280);

    if (kind === 'expense') {
      createExpense.mutate(
        {
          amount: candidate.amount,
          category: candidate.category as never,
          date: candidate.date,
          vendor: candidate.party || 'Bank transaction',
          notes,
          attachment: null,
        },
        {onSuccess: onSaved, onError},
      );
    } else {
      createIncome.mutate(
        {
          amount: candidate.amount,
          category: candidate.category as never,
          date: candidate.date,
          notes: candidate.party ? `${candidate.party} · ${notes}` : notes,
          attachment: null,
        },
        {onSuccess: onSaved, onError},
      );
    }
  };

  if (candidate.saved) {
    return (
      <View className="flex-row items-center justify-between rounded-2xl border border-success/30 bg-success/5 px-4 py-3">
        <Text className="text-sm font-semibold text-success">
          ✓ Saved as {kind === 'income' ? 'income' : 'expense'}
        </Text>
        <Pressable onPress={onViewTxns} accessibilityRole="button">
          <Text className="text-sm font-semibold text-primary">View</Text>
        </Pressable>
      </View>
    );
  }

  const categories = (kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES) as unknown as string[];

  return (
    <View className="rounded-2xl border border-border bg-white p-4">
      <View style={{gap: 14}}>
        <FormField label="Type">
          <SegmentedControl
            value={kind}
            options={KIND_OPTIONS}
            onChange={(value: Kind) =>
              onChange({
                kind: value,
                category: value === 'income' ? 'Sales' : 'Miscellaneous',
              })
            }
          />
        </FormField>

        <FormField label="Amount" required>
          <AmountInput
            value={candidate.amount}
            onChange={amount => onChange({amount})}
          />
        </FormField>

        <FormField label={kind === 'income' ? 'Received from' : 'Paid to'}>
          <TextField
            value={candidate.party}
            onChangeText={party => onChange({party})}
            placeholder={kind === 'income' ? 'Payer' : 'Merchant / payee'}
            maxLength={80}
          />
        </FormField>

        <FormField label="Category">
          <Select
            placeholder="Select category"
            options={categories}
            value={candidate.category}
            onSelect={category => onChange({category})}
          />
        </FormField>

        <FormField label="Date">
          <DateField value={candidate.date} onChange={date => onChange({date})} />
        </FormField>
      </View>

      <Text variant="caption" className="mt-3" numberOfLines={2}>
        💬 {candidate.rawText}
      </Text>

      <View className="mt-3 flex-row" style={{gap: 12}}>
        <Button
          title="Add transaction"
          className="flex-1"
          fullWidth={false}
          loading={saving}
          onPress={onSave}
        />
        <Button
          title="Ignore"
          variant="ghost"
          className="flex-1"
          fullWidth={false}
          onPress={onRemove}
        />
      </View>
    </View>
  );
}
