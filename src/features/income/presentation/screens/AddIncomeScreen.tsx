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
import type {AppScreenProps} from '@navigation/types';

/**
 * Add Income form. Validates locally, then delegates to the create use case
 * which saves online or queues offline transparently.
 */
export function AddIncomeScreen({
  navigation,
}: AppScreenProps<'AddIncome'>): React.JSX.Element {
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
          queued ? 'Saved offline' : 'Income added',
          queued
            ? "You're offline — this entry will sync automatically once you're back online."
            : 'Your income entry has been recorded.',
          [{text: 'OK', onPress: () => navigation.goBack()}],
        );
        form.reset();
      },
      onError: err => Alert.alert('Could not save', err.message),
    });
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">Add Income</Text>
        <Text variant="subtitle" className="mt-1">
          Record money coming into your business.
        </Text>

        {!online ? (
          <View className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-medium text-amber-700">
              You're offline. Entries are saved on this device and sync later.
            </Text>
          </View>
        ) : null}

        <View className="mt-6" style={{gap: 18}}>
          <FormField label="Amount" required error={form.errors.amount}>
            <AmountInput
              value={form.values.amount}
              onChange={value => form.setField('amount', value)}
              error={form.errors.amount}
              autoFocus
            />
          </FormField>

          <FormField label="Category" required error={form.errors.category}>
            <Select
              placeholder="Select category"
              options={INCOME_CATEGORIES}
              value={form.values.category}
              onSelect={value => form.setField('category', value)}
              error={form.errors.category}
            />
          </FormField>

          <FormField label="Date" required error={form.errors.date}>
            <DateField
              value={form.values.date}
              onChange={value => form.setField('date', value)}
              error={form.errors.date}
            />
          </FormField>

          <FormField
            label="Notes"
            error={form.errors.notes}
            hint="Optional — add a reference or description">
            <NotesInput
              value={form.values.notes}
              onChange={value => form.setField('notes', value)}
              error={form.errors.notes}
            />
          </FormField>

          <FormField label="Attachment" hint="Optional — attach a receipt photo">
            <AttachmentPicker
              value={form.values.attachment}
              onChange={value => form.setField('attachment', value)}
            />
          </FormField>
        </View>

        <Button
          title="Save income"
          className="mt-8"
          loading={createIncome.isPending}
          onPress={onSubmit}
        />
        <Button
          title="Cancel"
          variant="ghost"
          className="mt-2"
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  );
}
