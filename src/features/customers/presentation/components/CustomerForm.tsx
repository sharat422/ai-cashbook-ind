import React from 'react';
import {View} from 'react-native';

import {FormField, NotesInput, TextField} from '@components/form';
import type {useCustomerForm} from '@features/customers/presentation/hooks';

/**
 * The customer field set, reused by the add and edit screens. Driven by a
 * `useCustomerForm` instance passed in by the screen.
 */
export function CustomerForm({
  form,
}: {
  form: ReturnType<typeof useCustomerForm>;
}): React.JSX.Element {
  const {values, setField, errors} = form;
  return (
    <View style={{gap: 18}}>
      <FormField label="Full name" required error={errors.fullName}>
        <TextField
          value={values.fullName}
          onChangeText={v => setField('fullName', v)}
          placeholder="e.g. Rajesh Sharma"
          error={errors.fullName}
          maxLength={80}
        />
      </FormField>

      <FormField label="Mobile number" required error={errors.mobile}>
        <TextField
          value={values.mobile}
          onChangeText={v => setField('mobile', v.replace(/\D/g, ''))}
          placeholder="10-digit mobile number"
          keyboardType="number-pad"
          maxLength={10}
          error={errors.mobile}
        />
      </FormField>

      <FormField label="GST number" error={errors.gstNumber} hint="Optional">
        <TextField
          value={values.gstNumber ?? ''}
          onChangeText={v => setField('gstNumber', v.toUpperCase())}
          placeholder="15-character GSTIN"
          autoCapitalize="characters"
          maxLength={15}
          error={errors.gstNumber}
        />
      </FormField>

      <FormField label="Business name" hint="Optional">
        <TextField
          value={values.businessName ?? ''}
          onChangeText={v => setField('businessName', v)}
          placeholder="e.g. Sharma Traders"
        />
      </FormField>

      <FormField label="Address" hint="Optional">
        <NotesInput
          value={values.address ?? ''}
          onChange={v => setField('address', v)}
          placeholder="Shop / billing address"
          maxLength={200}
        />
      </FormField>

      <FormField label="Notes" error={errors.notes} hint="Optional">
        <NotesInput
          value={values.notes ?? ''}
          onChange={v => setField('notes', v)}
          placeholder="Anything to remember about this customer"
          maxLength={500}
          error={errors.notes}
        />
      </FormField>
    </View>
  );
}
