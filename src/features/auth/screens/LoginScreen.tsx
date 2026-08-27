import React, {useState} from 'react';
import {Alert} from 'react-native';

import {Button, Input, Text} from '@components/ui';
import {AuthShell} from '@features/auth/components/AuthShell';
import {useRequestOtp} from '@features/auth/hooks';
import {useT} from '@/i18n';
import type {AuthScreenProps} from '@navigation/types';
import {onlyDigits, validateMobile} from '@utils/validation';

/** Step 1: collect + validate the mobile number, then request an OTP. */
export function LoginScreen({
  navigation,
}: AuthScreenProps<'Login'>): React.JSX.Element {
  const t = useT();
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestOtp = useRequestOtp();

  const onContinue = () => {
    const validationError = validateMobile(mobile);
    setError(validationError);
    if (validationError) return;

    requestOtp.mutate(
      {mobile},
      {
        onSuccess: ({verificationId}) => {
          navigation.navigate('Otp', {verificationId, mobile});
        },
        onError: err => {
          Alert.alert(t('auth.login.otpError'), err.message);
        },
      },
    );
  };

  return (
    <AuthShell
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <Text className="text-center text-xs leading-5 text-muted">
          {t('auth.login.agreePrefix')}
          <Text className="text-xs font-semibold text-primary">
            {t('auth.terms')}
          </Text>
          {t('auth.login.and')}
          <Text className="text-xs font-semibold text-primary">
            {t('auth.privacy')}
          </Text>
          .
        </Text>
      }>
      <Input
        label={t('auth.login.mobileLabel')}
        prefix="+91"
        placeholder={t('auth.login.mobilePlaceholder')}
        keyboardType="number-pad"
        maxLength={10}
        value={mobile}
        onChangeText={text => {
          setMobile(onlyDigits(text));
          if (error) setError(null);
        }}
        error={error}
        returnKeyType="done"
        onSubmitEditing={onContinue}
      />

      <Button
        title={t('auth.login.continue')}
        className="mt-5"
        loading={requestOtp.isPending}
        onPress={onContinue}
      />
    </AuthShell>
  );
}
