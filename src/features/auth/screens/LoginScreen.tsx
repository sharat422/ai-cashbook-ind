import React, {useState} from 'react';
import {Alert} from 'react-native';

import {Button, Input, Text} from '@components/ui';
import {AuthShell} from '@features/auth/components/AuthShell';
import {useRequestOtp} from '@features/auth/hooks';
import type {AuthScreenProps} from '@navigation/types';
import {onlyDigits, validateMobile} from '@utils/validation';

/** Step 1: collect + validate the mobile number, then request an OTP. */
export function LoginScreen({
  navigation,
}: AuthScreenProps<'Login'>): React.JSX.Element {
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
          Alert.alert('Could not send OTP', err.message);
        },
      },
    );
  };

  return (
    <AuthShell
      title="Welcome"
      subtitle="Enter your mobile number and we'll send you a one-time password to sign in."
      footer={
        <Text className="text-center text-xs leading-5 text-muted">
          By continuing you agree to our{' '}
          <Text className="text-xs font-semibold text-primary">
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text className="text-xs font-semibold text-primary">
            Privacy Policy
          </Text>
          .
        </Text>
      }>
      <Input
        label="Mobile number"
        prefix="+91"
        placeholder="10-digit mobile number"
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
        title="Continue"
        className="mt-5"
        loading={requestOtp.isPending}
        onPress={onContinue}
      />
    </AuthShell>
  );
}
