import React, {useEffect, useState} from 'react';
import {Alert, View} from 'react-native';

import {Button, Text} from '@components/ui';
import {AuthShell} from '@features/auth/components/AuthShell';
import {ConsentRow} from '@features/consent/presentation/components/ConsentRow';
import {
  CONSENT_COPY,
  hasRequiredConsent,
  type ConsentState,
} from '@features/consent/domain/entities';
import {
  useConsents,
  useUpdateConsents,
} from '@features/consent/presentation/hooks';
import {useT} from '@/i18n';
import type {OnboardingScreenProps} from '@navigation/types';

/**
 * Onboarding step: capture GRANULAR consent before the business is created.
 * Core is required (locked on); marketing and AI are optional and off by
 * default. If the user already satisfied the required consent under the current
 * policy (e.g. they dropped off after this step), we skip straight ahead.
 */
export function ConsentScreen({
  navigation,
}: OnboardingScreenProps<'Consent'>): React.JSX.Element {
  const t = useT();
  const {data, isLoading} = useConsents();
  const update = useUpdateConsents();

  const [marketing, setMarketing] = useState(false);
  const [ai, setAi] = useState(false);

  // Seed optional toggles from any prior choice; skip the step entirely if the
  // required consent is already recorded for the current policy version.
  useEffect(() => {
    if (!data) return;
    if (hasRequiredConsent(data)) {
      navigation.replace('CreateBusiness');
      return;
    }
    setMarketing(
      !!data.consents.find((c: ConsentState) => c.purpose === 'marketing')
        ?.granted,
    );
    setAi(!!data.consents.find((c: ConsentState) => c.purpose === 'ai')?.granted);
  }, [data, navigation]);

  const onAgree = () => {
    update.mutate(
      [
        {purpose: 'core', granted: true},
        {purpose: 'marketing', granted: marketing},
        {purpose: 'ai', granted: ai},
      ],
      {
        onSuccess: () => navigation.replace('CreateBusiness'),
        onError: err =>
          Alert.alert(t('consent.saveErrorTitle'), err.message),
      },
    );
  };

  if (isLoading) {
    return (
      <AuthShell title={t('consent.title')} subtitle={t('consent.subtitle')}>
        <Text className="text-sm text-muted">{t('common.loading')}</Text>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('consent.title')}
      subtitle={t('consent.subtitle')}
      footer={
        <Text className="text-center text-xs leading-5 text-muted">
          {t('consent.footerNote')}
        </Text>
      }>
      <View style={{gap: 12}}>
        <ConsentRow
          title={t(CONSENT_COPY.core.title)}
          description={t(CONSENT_COPY.core.description)}
          value={true}
          required
          requiredLabel={t('consent.required')}
        />
        <ConsentRow
          title={t(CONSENT_COPY.marketing.title)}
          description={t(CONSENT_COPY.marketing.description)}
          value={marketing}
          onValueChange={setMarketing}
        />
        <ConsentRow
          title={t(CONSENT_COPY.ai.title)}
          description={t(CONSENT_COPY.ai.description)}
          value={ai}
          onValueChange={setAi}
        />
      </View>

      <Button
        title={t('consent.agreeContinue')}
        className="mt-6"
        loading={update.isPending}
        onPress={onAgree}
      />
    </AuthShell>
  );
}
