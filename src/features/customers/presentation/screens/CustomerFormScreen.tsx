import React from 'react';
import {Alert, View} from 'react-native';

import {ApiError} from '@api/client';
import {Button, Screen, Text} from '@components/ui';
import {CustomerForm} from '@features/customers/presentation/components';
import {
  useCustomerForm,
  useCustomerMutations,
} from '@features/customers/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/** Add or edit a customer. Edit mode when a customer is passed in params. */
export function CustomerFormScreen({
  navigation,
  route,
}: AppScreenProps<'CustomerForm'>): React.JSX.Element {
  const t = useT();
  const editing = route.params?.customer;
  const form = useCustomerForm(editing);
  const {create, update} = useCustomerMutations();
  const isSaving = create.isPending || update.isPending;

  const onSubmit = () => {
    form.markSubmitAttempted();
    if (!form.isValid) return;

    const onError = (err: Error) => {
      // 409 = another device edited this customer since it was loaded. Don't
      // clobber their change — tell the user to reload the latest version.
      if (err instanceof ApiError && err.status === 409) {
        Alert.alert(t('customers.conflictTitle'), t('customers.conflictMsg'), [
          {text: t('common.ok'), onPress: () => navigation.goBack()},
        ]);
        return;
      }
      Alert.alert(t('form.couldNotSave'), err.message);
    };

    if (editing) {
      update.mutate(
        {
          id: editing.id,
          draft: form.draft,
          expectedVersion: editing.version,
        },
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
          {editing ? t('customers.editTitle') : t('customers.addTitle')}
        </Text>
        <Text variant="subtitle" className="mt-1">
          {editing ? t('customers.editSubtitle') : t('customers.addSubtitle')}
        </Text>

        <View className="mt-6">
          <CustomerForm form={form} />
        </View>

        <Button
          title={editing ? t('customers.saveChanges') : t('customers.addTitle')}
          className="mt-8"
          loading={isSaving}
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
