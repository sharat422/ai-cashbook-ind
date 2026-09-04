import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {ApiError} from '@api/client';
import {
  AmountInput,
  AttachmentPicker,
  ChipSelect,
  DateField,
  FormField,
  NotesInput,
  TextField,
} from '@components/form';
import {Button, Screen, Text} from '@components/ui';
import type {ParsedExpense} from '@features/expense/data/expenseParse.remote';
import {EXPENSE_CATEGORIES} from '@features/expense/domain/entities';
import {
  useCreateExpense,
  useExpenseForm,
  useVoiceExpense,
} from '@features/expense/presentation/hooks';
import {
  ensureMicPermission,
  isVoiceAvailable,
  MIN_RECORDING_MS,
  startRecording,
  stopRecording,
} from '@features/ai-entry/data/voiceRecorder';
import {useVoiceSettingsStore} from '@features/settings/store/voiceSettings.store';
import {useConnectivity} from '@features/income/presentation/hooks';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

/** Emoji per category for friendlier chips. */
const CATEGORY_ICONS: Record<string, string> = {
  Rent: '🏠',
  Salary: '👤',
  Fuel: '⛽',
  Food: '🍽️',
  Travel: '✈️',
  Utilities: '💡',
  Miscellaneous: '📦',
};

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map(value => ({
  value,
  icon: CATEGORY_ICONS[value],
}));

/** Friendly i18n label for each server-flagged ambiguous field. */
const AMBIGUOUS_LABEL: Record<string, TKey> = {
  amount: 'form.amount',
  currency: 'expense.currency',
  category: 'form.category',
  vendor: 'expense.vendorLabel',
  date: 'form.date',
};

/**
 * Add Expense form. Offline-first + optimistic: saving returns instantly with a
 * local entry, then syncs in the background.
 */
export function AddExpenseScreen({
  navigation,
  route,
}: AppScreenProps<'AddExpense'>): React.JSX.Element {
  const t = useT();
  const online = useConnectivity();
  // Seed the form when arriving from a receipt scan (or any prefill source).
  const form = useExpenseForm({
    ...route.params?.initialValues,
    attachment: route.params?.initialAttachment ?? null,
  });
  const createExpense = useCreateExpense();
  const voice = useVoiceExpense();
  const voiceAvailable = isVoiceAvailable();
  const voiceLanguage = useVoiceSettingsStore(s => s.language);
  const [recording, setRecording] = useState(false);
  // The parse result drives a "please review" banner after a voice entry.
  const [review, setReview] = useState<ParsedExpense | null>(null);

  /** Seed the form from a voice parse; anything null is left for the user. */
  const applyParsed = (p: ParsedExpense) => {
    if (p.amount != null) form.setField('amount', p.amount);
    if (p.category) form.setField('category', p.category);
    if (p.vendor) form.setField('vendor', p.vendor);
    if (p.date) form.setField('date', p.date);
    if (p.note) form.setField('notes', p.note);
    setReview(p);
  };

  const onVoiceError = (err: unknown) => {
    const badAudio = err instanceof ApiError && err.status === 422;
    Alert.alert(
      badAudio ? t('ai.didntCatch') : t('ai.voiceUnavailable'),
      badAudio ? t('ai.didntCatchMsg') : t('ai.voiceUnavailableMsg'),
    );
  };

  /** Tap to record, tap again to stop → transcribe + extract → prefill. */
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
      if (audio.durationMs > 0 && audio.durationMs < MIN_RECORDING_MS) {
        return Alert.alert(t('ai.tooShortTitle'), t('ai.tooShortMsg'));
      }
      voice.mutate(
        {
          audio,
          today: toISODate(new Date()),
          language: voiceLanguage ?? undefined,
        },
        {onSuccess: applyParsed, onError: onVoiceError},
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

  const onSubmit = () => {
    form.markSubmitAttempted();
    if (!form.isValid) return;

    createExpense.mutate(form.draft, {
      onSuccess: () => {
        form.reset();
        navigation.goBack();
      },
      onError: err => Alert.alert(t('form.couldNotSave'), err.message),
    });
  };

  return (
    <Screen>
      <View className="py-6">
        {/* Voice entry — speak the expense in any language (server extracts it) */}
        {voiceAvailable ? (
          <View className="mb-5">
            <Pressable
              accessibilityRole="button"
              onPress={onMic}
              disabled={voice.isPending}
              className={`flex-row items-center justify-center rounded-2xl px-4 py-3.5 ${
                recording ? 'bg-danger' : 'bg-primary'
              }`}
              style={{gap: 10, opacity: voice.isPending ? 0.6 : 1}}>
              <Text className="text-xl">{recording ? '⏹' : '🎤'}</Text>
              <Text className="text-base font-semibold text-white">
                {voice.isPending
                  ? t('expense.voiceReading')
                  : recording
                  ? t('expense.voiceListening')
                  : t('expense.voiceSpeak')}
              </Text>
            </Pressable>
            <Text variant="caption" className="mt-2 text-center">
              {t('expense.voiceHint')}
            </Text>
          </View>
        ) : null}

        {/* Post-voice review: what was heard + any fields to double-check */}
        {review ? (
          <View
            className={`mb-4 rounded-xl px-4 py-3 ${
              review.needsConfirmation ? 'bg-amber-50' : 'bg-emerald-50'
            }`}>
            <Text
              className={`text-sm font-semibold ${
                review.needsConfirmation ? 'text-amber-800' : 'text-emerald-800'
              }`}>
              {review.needsConfirmation
                ? t('expense.reviewTitle')
                : t('expense.reviewOk')}
            </Text>
            {review.needsConfirmation && review.ambiguousFields.length > 0 ? (
              <Text className="mt-1 text-xs text-amber-700">
                {review.ambiguousFields
                  .map(f => (AMBIGUOUS_LABEL[f] ? t(AMBIGUOUS_LABEL[f]) : f))
                  .join(' · ')}
              </Text>
            ) : null}
            {review.transcript ? (
              <Text className="mt-1 text-xs italic text-slate-500">
                {t('expense.reviewHeard', {text: review.transcript})}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Hero amount card */}
        <View className="rounded-3xl bg-slate-900 px-5 pb-6 pt-5">
          <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {t('expense.amountLabel')}
          </Text>
          <View className="mt-3">
            <AmountInput
              value={form.values.amount}
              onChange={value => form.setField('amount', value)}
              error={form.errors.amount}
              autoFocus
            />
          </View>
          {form.errors.amount ? (
            <Text className="mt-2 text-xs text-red-300">
              {form.errors.amount}
            </Text>
          ) : null}
        </View>

        {!online ? (
          <View className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-medium text-amber-700">
              {t('entry.offlineBanner')}
            </Text>
          </View>
        ) : null}

        <View className="mt-6" style={{gap: 18}}>
          <FormField label={t('form.category')} required error={form.errors.category}>
            <ChipSelect
              options={CATEGORY_OPTIONS}
              value={form.values.category}
              onSelect={value => form.setField('category', value)}
              error={form.errors.category}
            />
          </FormField>

          <FormField label={t('expense.vendorLabel')} error={form.errors.vendor}>
            <TextField
              placeholder={t('expense.vendorPlaceholder')}
              value={form.values.vendor}
              onChangeText={value => form.setField('vendor', value)}
              error={form.errors.vendor}
              maxLength={80}
              returnKeyType="done"
            />
          </FormField>

          <FormField label={t('form.date')} required error={form.errors.date}>
            <DateField
              value={form.values.date}
              onChange={value => form.setField('date', value)}
              error={form.errors.date}
            />
          </FormField>

          <FormField
            label={t('form.notes')}
            error={form.errors.notes}
            hint={t('form.notesHint')}>
            <NotesInput
              value={form.values.notes}
              onChange={value => form.setField('notes', value)}
              error={form.errors.notes}
            />
          </FormField>

          <FormField label={t('form.attachment')} hint={t('expense.attachmentHint')}>
            <AttachmentPicker
              value={form.values.attachment}
              onChange={value => form.setField('attachment', value)}
            />
          </FormField>
        </View>

        <Button
          title={t('expense.save')}
          className="mt-8"
          loading={createExpense.isPending}
          onPress={onSubmit}
        />
        <Button
          title={t('common.cancel')}
          variant="ghost"
          className="mt-2"
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  );
}
