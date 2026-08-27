import React from 'react';
import {Alert, View} from 'react-native';

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
import {EXPENSE_CATEGORIES} from '@features/expense/domain/entities';
import {useCreateExpense, useExpenseForm} from '@features/expense/presentation/hooks';
import {useConnectivity} from '@features/income/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

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

          <FormField label={t('expense.vendorLabel')} required error={form.errors.vendor}>
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
