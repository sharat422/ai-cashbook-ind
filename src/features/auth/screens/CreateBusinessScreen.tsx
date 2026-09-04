import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {
  Button,
  Input,
  SegmentedControl,
  Select,
} from '@components/ui';
import {AuthShell} from '@features/auth/components/AuthShell';
import {
  BUSINESS_TYPES,
  INDIAN_STATES,
  type BusinessType,
  type IndianState,
} from '@config/constants';
import {useCreateBusiness} from '@features/auth/hooks';
import {
  DEFAULT_APP_LANGUAGE,
  APP_LANGUAGE_LABEL,
  appLanguageByLabel,
  SUPPORTED_APP_LANGUAGES,
  type AppLanguage,
} from '@features/auth/utils/languagePreference';
import {useAuthStore} from '@store/auth.store';
import {useT} from '@/i18n';
import {validateRequired} from '@utils/validation';

interface FormState {
  businessName: string;
  ownerName: string;
  businessType: BusinessType | null;
  state: IndianState | null;
  gstRegistered: boolean | null;
  preferredLanguage: AppLanguage;
}

interface FormErrors {
  businessName?: string | null;
  ownerName?: string | null;
  businessType?: string | null;
  state?: string | null;
  gstRegistered?: string | null;
}

/**
 * Step 3 (onboarding): create the business profile. Saving it transitions the
 * auth store to "authenticated", which moves the user to the Dashboard.
 */
export function CreateBusinessScreen(): React.JSX.Element {
  const t = useT();
  const GST_OPTIONS = [
    {label: t('common.yes'), value: true},
    {label: t('common.no'), value: false},
  ] as const;
  const [form, setForm] = useState<FormState>({
    businessName: '',
    ownerName: '',
    businessType: null,
    state: null,
    gstRegistered: null,
    preferredLanguage: DEFAULT_APP_LANGUAGE,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const createBusiness = useCreateBusiness();
  const setPreferredLanguage = useAuthStore(state => state.setPreferredLanguage);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({...prev, [key]: value}));
    const errorKey = key as keyof FormErrors;
    if (errorKey in errors && errors[errorKey]) {
      setErrors(prev => ({...prev, [errorKey]: null}));
    }
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

    // Persist the language choice up front. It's a local UI preference (not
    // server-dependent), so we must not gate it on a per-call mutation callback
    // — React Query skips those if this screen unmounts as the business is
    // created, which would silently drop the selection and show English.
    setPreferredLanguage(form.preferredLanguage);

    createBusiness.mutate(
      {
        businessName: form.businessName.trim(),
        ownerName: form.ownerName.trim(),
        businessType: form.businessType as BusinessType,
        state: form.state as IndianState,
        gstRegistered: form.gstRegistered as boolean,
      },
      {
        onError: err => Alert.alert(t('auth.business.error'), err.message),
      },
    );
  };

  return (
    <AuthShell
      title={t('auth.business.title')}
      subtitle={t('auth.business.subtitle')}>
      <View style={{gap: 18}}>
          <Input
            label={t('auth.business.nameLabel')}
            placeholder={t('auth.business.namePlaceholder')}
            value={form.businessName}
            onChangeText={value => update('businessName', value)}
            error={errors.businessName}
          />

          <Input
            label={t('auth.business.ownerLabel')}
            placeholder={t('auth.business.ownerPlaceholder')}
            value={form.ownerName}
            onChangeText={value => update('ownerName', value)}
            error={errors.ownerName}
          />

          <Select
            label={t('auth.business.typeLabel')}
            placeholder={t('auth.business.typePlaceholder')}
            options={BUSINESS_TYPES}
            value={form.businessType}
            onSelect={value => update('businessType', value)}
            error={errors.businessType}
          />

          <Select
            label={t('auth.business.stateLabel')}
            placeholder={t('auth.business.statePlaceholder')}
            options={INDIAN_STATES}
            value={form.state}
            onSelect={value => update('state', value)}
            error={errors.state}
          />

          <SegmentedControl
            label={t('auth.business.gstLabel')}
            options={GST_OPTIONS}
            value={form.gstRegistered}
            onChange={value => update('gstRegistered', value)}
            error={errors.gstRegistered}
          />

          <Select
            label={t('auth.business.languageLabel')}
            options={SUPPORTED_APP_LANGUAGES.map(l => APP_LANGUAGE_LABEL[l])}
            value={APP_LANGUAGE_LABEL[form.preferredLanguage]}
            onSelect={label => update('preferredLanguage', appLanguageByLabel(label))}
          />
        </View>

      <Button
        title={t('auth.business.submit')}
        className="mt-8"
        loading={createBusiness.isPending}
        onPress={onSubmit}
      />
    </AuthShell>
  );
}
