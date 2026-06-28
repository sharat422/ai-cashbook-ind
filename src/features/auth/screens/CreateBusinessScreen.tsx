import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {
  Button,
  Input,
  Screen,
  SegmentedControl,
  Select,
  Text,
} from '@components/ui';
import {
  BUSINESS_TYPES,
  INDIAN_STATES,
  type BusinessType,
  type IndianState,
} from '@config/constants';
import {useCreateBusiness} from '@features/auth/hooks';
import {validateRequired} from '@utils/validation';

interface FormState {
  businessName: string;
  ownerName: string;
  businessType: BusinessType | null;
  state: IndianState | null;
  gstRegistered: boolean | null;
}

interface FormErrors {
  businessName?: string | null;
  ownerName?: string | null;
  businessType?: string | null;
  state?: string | null;
  gstRegistered?: string | null;
}

const GST_OPTIONS = [
  {label: 'Yes', value: true},
  {label: 'No', value: false},
] as const;

/**
 * Step 3 (onboarding): create the business profile. Saving it transitions the
 * auth store to "authenticated", which moves the user to the Dashboard.
 */
export function CreateBusinessScreen(): React.JSX.Element {
  const [form, setForm] = useState<FormState>({
    businessName: '',
    ownerName: '',
    businessType: null,
    state: null,
    gstRegistered: null,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const createBusiness = useCreateBusiness();

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({...prev, [key]: value}));
    if (errors[key]) setErrors(prev => ({...prev, [key]: null}));
  };

  const validate = (): boolean => {
    const next: FormErrors = {
      businessName: validateRequired(form.businessName, 'Business name'),
      ownerName: validateRequired(form.ownerName, 'Owner name'),
      businessType: form.businessType ? null : 'Select a business type',
      state: form.state ? null : 'Select a state',
      gstRegistered:
        form.gstRegistered === null ? 'Select an option' : null,
    };
    setErrors(next);
    return Object.values(next).every(error => !error);
  };

  const onSubmit = () => {
    if (!validate()) return;

    createBusiness.mutate(
      {
        businessName: form.businessName.trim(),
        ownerName: form.ownerName.trim(),
        businessType: form.businessType as BusinessType,
        state: form.state as IndianState,
        gstRegistered: form.gstRegistered as boolean,
      },
      {
        onError: err => Alert.alert('Could not create business', err.message),
      },
    );
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">Set up your business</Text>
        <Text variant="subtitle" className="mt-2">
          Tell us a bit about your business to finish setting up your account.
        </Text>

        <View className="mt-8" style={{gap: 18}}>
          <Input
            label="Business name"
            placeholder="e.g. Sharma Traders"
            value={form.businessName}
            onChangeText={value => update('businessName', value)}
            error={errors.businessName}
          />

          <Input
            label="Owner name"
            placeholder="e.g. Rajesh Sharma"
            value={form.ownerName}
            onChangeText={value => update('ownerName', value)}
            error={errors.ownerName}
          />

          <Select
            label="Business type"
            placeholder="Select business type"
            options={BUSINESS_TYPES}
            value={form.businessType}
            onSelect={value => update('businessType', value)}
            error={errors.businessType}
          />

          <Select
            label="State"
            placeholder="Select state"
            options={INDIAN_STATES}
            value={form.state}
            onSelect={value => update('state', value)}
            error={errors.state}
          />

          <SegmentedControl
            label="GST registered?"
            options={GST_OPTIONS}
            value={form.gstRegistered}
            onChange={value => update('gstRegistered', value)}
            error={errors.gstRegistered}
          />
        </View>

        <Button
          title="Create business"
          className="mt-8"
          loading={createBusiness.isPending}
          onPress={onSubmit}
        />
      </View>
    </Screen>
  );
}
