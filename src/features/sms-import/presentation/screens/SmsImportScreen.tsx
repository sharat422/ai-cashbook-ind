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
import {useT} from '@/i18n';
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
  const t = useT();
  const scanSupported = isSmsScanSupported();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [scanning, setScanning] = useState(false);

  const onScan = async () => {
    const perm = await requestSmsPermission();
    if (perm === 'blocked') {
      Alert.alert(t('sms.permTitle'), t('sms.permMsg'), [
        {text: t('common.cancel'), style: 'cancel'},
        {text: t('sms.openSettings'), onPress: () => Linking.openSettings()},
      ]);
      return;
    }
    if (perm !== 'granted') return; // denied / unsupported → silently no-op

    setScanning(true);
    try {
      const {parsed} = await scanBankSms({maxCount: 200, sinceDays: 90});
      setCandidates(prev => mergeNew(prev, parsed));
      if (parsed.length === 0) {
        Alert.alert(t('sms.noneTitle'), t('sms.noneMsg'));
      }
    } catch (e) {
      Alert.alert(
        t('sms.readErrorTitle'),
        e instanceof Error ? e.message : t('ai.tryAgain'),
      );
    } finally {
      setScanning(false);
    }
  };

  const onDetectPaste = () => {
    const parsed = parseBankSms(pasteText);
    if (!parsed) {
      Alert.alert(t('sms.pasteFailTitle'), t('sms.pasteFailMsg'));
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
        <Text variant="title">{t('sms.title')}</Text>
        <Text variant="subtitle" className="mt-0.5">
          {t('sms.subtitle')}
        </Text>

        {/* Scan (Android) */}
        {scanSupported ? (
          <Button
            title={scanning ? t('sms.scanning') : t('sms.scanBtn')}
            className="mt-5"
            loading={scanning}
            onPress={onScan}
          />
        ) : (
          <View className="mt-5 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-medium text-amber-700">
              {t('sms.iosNotice')}
            </Text>
          </View>
        )}

        {/* Paste (all platforms) */}
        <View className="mt-4 rounded-2xl border border-border bg-white p-4">
          <Text variant="label" className="mb-2">
            {t('sms.pasteLabel')}
          </Text>
          <TextInput
            className="min-h-[64px] rounded-xl border border-border p-3 text-sm text-slate-900"
            value={pasteText}
            onChangeText={setPasteText}
            placeholder={t('sms.pastePlaceholder')}
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
          />
          <Button
            title={t('sms.detectBtn')}
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
              title={t('sms.emptyTitle')}
              message={scanSupported ? t('sms.emptyScan') : t('sms.emptyPaste')}
            />
          </View>
        ) : (
          <View className="mt-6" style={{gap: 12}}>
            <Text variant="label">
              {t('sms.toReview', {
                count: candidates.filter(c => !c.saved).length,
              })}
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
  const t = useT();
  const createExpense = useCreateExpense();
  const createIncome = useCreateIncome();
  const saving = createExpense.isPending || createIncome.isPending;
  const {kind} = candidate;
  const KIND_OPTIONS = [
    {label: t('sms.kindExpense'), value: 'expense' as Kind},
    {label: t('sms.kindIncome'), value: 'income' as Kind},
  ];

  const onSave = () => {
    if (Number.isNaN(candidate.amount) || candidate.amount <= 0) {
      Alert.alert(t('sms.enterAmountTitle'), t('sms.enterAmountMsg'));
      return;
    }
    const onError = (e: unknown) =>
      Alert.alert(
        t('form.couldNotSave'),
        e instanceof Error ? e.message : t('ai.tryAgain'),
      );
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
          {kind === 'income' ? t('sms.savedAsIncome') : t('sms.savedAsExpense')}
        </Text>
        <Pressable onPress={onViewTxns} accessibilityRole="button">
          <Text className="text-sm font-semibold text-primary">{t('sms.view')}</Text>
        </Pressable>
      </View>
    );
  }

  const categories = (kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES) as unknown as string[];

  return (
    <View className="rounded-2xl border border-border bg-white p-4">
      <View style={{gap: 14}}>
        <FormField label={t('ai.type')}>
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

        <FormField label={t('form.amount')} required>
          <AmountInput
            value={candidate.amount}
            onChange={amount => onChange({amount})}
          />
        </FormField>

        <FormField label={kind === 'income' ? t('sms.receivedFrom') : t('sms.paidTo')}>
          <TextField
            value={candidate.party}
            onChangeText={party => onChange({party})}
            placeholder={kind === 'income' ? t('sms.payer') : t('sms.merchant')}
            maxLength={80}
          />
        </FormField>

        <FormField label={t('form.category')}>
          <Select
            placeholder={t('form.selectCategory')}
            options={categories}
            value={candidate.category}
            onSelect={category => onChange({category})}
          />
        </FormField>

        <FormField label={t('form.date')}>
          <DateField value={candidate.date} onChange={date => onChange({date})} />
        </FormField>
      </View>

      <Text variant="caption" className="mt-3" numberOfLines={2}>
        💬 {candidate.rawText}
      </Text>

      <View className="mt-3 flex-row" style={{gap: 12}}>
        <Button
          title={t('sms.add')}
          className="flex-1"
          fullWidth={false}
          loading={saving}
          onPress={onSave}
        />
        <Button
          title={t('sms.ignore')}
          variant="ghost"
          className="flex-1"
          fullWidth={false}
          onPress={onRemove}
        />
      </View>
    </View>
  );
}
