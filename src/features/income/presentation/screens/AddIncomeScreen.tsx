import React from 'react';
import {Alert, View} from 'react-native';

import {
  AmountInput,
  AttachmentPicker,
  DateField,
  FormField,
  NotesInput,
} from '@components/form';
import {Button, Screen, Select, Text} from '@components/ui';
import {INCOME_CATEGORIES} from '@features/income/domain/entities';
import {
  useConnectivity,
  useCreateIncome,
  useIncomeForm,
} from '@features/income/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/**
 * Add Income form. Validates locally, then delegates to the create use case
 * which saves online or queues offline transparently.
 */
export function AddIncomeScreen({
  navigation,
}: AppScreenProps<'AddIncome'>): React.JSX.Element {
  const t = useT();
  const online = useConnectivity();
  const form = useIncomeForm();
  const createIncome = useCreateIncome();

  const onSubmit = () => {
    form.markSubmitAttempted();
    if (!form.isValid) return;

    createIncome.mutate(form.draft, {
      onSuccess: income => {
        const queued = income.syncStatus === 'pending';
        Alert.alert(
          queued ? t('entry.savedOfflineTitle') : t('income.addedTitle'),
          queued ? t('entry.savedOfflineMsg') : t('income.addedMsg'),
          [{text: t('common.ok'), onPress: () => navigation.goBack()}],
        );
        form.reset();
      },
      onError: err => Alert.alert(t('form.couldNotSave'), err.message),
    });
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('income.title')}</Text>
        <Text variant="subtitle" className="mt-1">
          {t('income.subtitle')}
        </Text>

        {!online ? (
          <View className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-medium text-amber-700">
              {t('entry.offlineBanner')}
            </Text>
          </View>
        ) : null}

        <View className="mt-6" style={{gap: 18}}>
          <FormField label={t('form.amount')} required error={form.errors.amount}>
            <AmountInput
              value={form.values.amount}
              onChange={value => form.setField('amount', value)}
              error={form.errors.amount}
              autoFocus
            />
          </FormField>

          <FormField label={t('form.category')} required error={form.errors.category}>
            <Select
              placeholder={t('form.selectCategory')}
              options={INCOME_CATEGORIES}
              value={form.values.category}
              onSelect={value => form.setField('category', value)}
              error={form.errors.category}
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

          <FormField label={t('form.attachment')} hint={t('income.attachmentHint')}>
            <AttachmentPicker
              value={form.values.attachment}
              onChange={value => form.setField('attachment', value)}
            />
          </FormField>
        </View>

        <Button
          title={t('income.save')}
          className="mt-8"
          loading={createIncome.isPending}
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
