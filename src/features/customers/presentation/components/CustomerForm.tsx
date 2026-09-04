import React from 'react';
import {View} from 'react-native';

import {FormField, NotesInput, TextField} from '@components/form';
import type {useCustomerForm} from '@features/customers/presentation/hooks';
import {useT} from '@/i18n';

/**
 * The customer field set, reused by the add and edit screens. Driven by a
 * `useCustomerForm` instance passed in by the screen.
 */
export function CustomerForm({
  form,
}: {
  form: ReturnType<typeof useCustomerForm>;
}): React.JSX.Element {
  const t = useT();
  const {values, setField, errors} = form;
  return (
    <View style={{gap: 18}}>
      <FormField label={t('customers.fullName')} required error={errors.fullName}>
        <TextField
          value={values.fullName}
          onChangeText={v => setField('fullName', v)}
          placeholder={t('customers.fullNamePlaceholder')}
          error={errors.fullName}
          maxLength={80}
        />
      </FormField>

      <FormField label={t('customers.mobileNumber')} required error={errors.mobile}>
        <TextField
          value={values.mobile}
          onChangeText={v => setField('mobile', v.replace(/\D/g, ''))}
          placeholder={t('customers.mobilePlaceholder')}
          keyboardType="number-pad"
          maxLength={10}
          error={errors.mobile}
        />
      </FormField>

      <FormField
        label={t('customers.gst')}
        error={errors.gstNumber}
        hint={t('common.optional')}>
        <TextField
          value={values.gstNumber ?? ''}
          onChangeText={v => setField('gstNumber', v.toUpperCase())}
          placeholder={t('customers.gstPlaceholder')}
          autoCapitalize="characters"
          maxLength={15}
          error={errors.gstNumber}
        />
      </FormField>

      <FormField label={t('customers.businessName')} hint={t('common.optional')}>
        <TextField
          value={values.businessName ?? ''}
          onChangeText={v => setField('businessName', v)}
          placeholder={t('customers.businessNamePlaceholder')}
        />
      </FormField>

      <FormField label={t('customers.address')} hint={t('common.optional')}>
        <NotesInput
          value={values.address ?? ''}
          onChange={v => setField('address', v)}
          placeholder={t('customers.addressPlaceholder')}
          maxLength={200}
        />
      </FormField>

      <FormField label={t('form.notes')} error={errors.notes} hint={t('common.optional')}>
        <NotesInput
          value={values.notes ?? ''}
          onChange={v => setField('notes', v)}
          placeholder={t('customers.notesPlaceholder')}
          maxLength={500}
          error={errors.notes}
        />
      </FormField>
    </View>
  );
}
