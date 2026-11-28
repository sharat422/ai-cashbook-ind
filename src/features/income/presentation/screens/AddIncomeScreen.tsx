import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {
  AmountInput,
  AttachmentPicker,
  DateField,
  FormField,
  NotesInput,
  alertFieldErrors,
} from '@components/form';
import {Button, Screen, Select, Text} from '@components/ui';
import {incomeRemote} from '@features/income/data/income.remote';
import {INCOME_CATEGORIES, type IncomeCategory} from '@features/income/domain/entities';
import {
  useConnectivity,
  useCreateIncome,
  useIncomeForm,
} from '@features/income/presentation/hooks';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useT} from '@/i18n';
import {categoryLabel} from '@/i18n/labels';
import type {AppScreenProps} from '@navigation/types';

/**
 * Add Income form. Validates locally, then delegates to the create use case
 * which saves online or queues offline transparently. With `edit` (the owner,
 * from Entry details) it fixes a synced income instead: online only, and the
 * photo stays as it is.
 */
export function AddIncomeScreen({
  navigation,
  route,
}: AppScreenProps<'AddIncome'>): React.JSX.Element {
  const t = useT();
  const online = useConnectivity();
  const edit = route.params?.edit;
  const form = useIncomeForm(edit && {amount: edit.amount, category: edit.category as IncomeCategory,
    date: edit.date, notes: edit.notes ?? ''});
  const createIncome = useCreateIncome();
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);

  const saveEdit = async (id: string) => {
    setUpdating(true);
    try {
      const {amount, category, date, notes} = form.draft;
      const saved = await incomeRemote.update(id, {amount, category, date, notes: notes ?? ''});
      useIncomeStore.getState().replaceEntry(id, saved);
      await queryClient.invalidateQueries(); // Reports, Dashboard, history: all from the fixed figure
      Alert.alert(t('income.updatedTitle'), undefined, [{text: t('common.ok'), onPress: () => navigation.pop(2)}]);
    } catch (e) {
      Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setUpdating(false);
    }
  };

  const onSubmit = () => {
    form.markSubmitAttempted();
    if (alertFieldErrors(form.allErrors)) return;
    if (edit) {
      void saveEdit(edit.id);
      return;
    }

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
        <Text variant="title">{edit ? t('income.editTitle') : t('income.title')}</Text>
        <Text variant="subtitle" className="mt-1">
          {edit ? t('income.editSubtitle') : t('income.subtitle')}
        </Text>

        {!online && !edit ? (
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
              labelOf={c => categoryLabel(t, c)}
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

          {edit ? null : (
            <FormField label={t('form.attachment')} hint={t('income.attachmentHint')}>
              <AttachmentPicker
                value={form.values.attachment}
                onChange={value => form.setField('attachment', value)}
              />
            </FormField>
          )}
        </View>

        <Button
          testID="income-save"
          title={edit ? t('common.save') : t('income.save')}
          className="mt-8"
          loading={createIncome.isPending || updating}
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
