import React from 'react';
import {Alert, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {CustomerForm} from '@features/customers/presentation/components';
import {
  useCustomerForm,
  useCustomerMutations,
} from '@features/customers/presentation/hooks';
import type {AppScreenProps} from '@navigation/types';

/** Add or edit a customer. Edit mode when a customer is passed in params. */
export function CustomerFormScreen({
  navigation,
  route,
}: AppScreenProps<'CustomerForm'>): React.JSX.Element {
  const editing = route.params?.customer;
  const form = useCustomerForm(editing);
  const {create, update} = useCustomerMutations();
  const isSaving = create.isPending || update.isPending;

  const onSubmit = () => {
    form.markSubmitAttempted();
    if (!form.isValid) return;

    const onError = (err: Error) =>
      Alert.alert('Could not save', err.message);

    if (editing) {
      update.mutate(
        {id: editing.id, draft: form.draft},
        {onSuccess: () => navigation.goBack(), onError},
      );
    } else {
      create.mutate(form.draft, {
        onSuccess: () => navigation.goBack(),
        onError,
      });
    }
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">
          {editing ? 'Edit customer' : 'Add customer'}
        </Text>
        <Text variant="subtitle" className="mt-1">
          {editing
            ? 'Update this customer’s details.'
            : 'Save a customer to track dues and transactions.'}
        </Text>

        <View className="mt-6">
          <CustomerForm form={form} />
        </View>

        <Button
          title={editing ? 'Save changes' : 'Add customer'}
          className="mt-8"
          loading={isSaving}
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
