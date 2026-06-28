import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {Button, Input, Screen, Text} from '@components/ui';
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
    <Screen>
      <View className="flex-1 justify-center py-10">
        <Text variant="title">Welcome to Smart CashBook</Text>
        <Text variant="subtitle" className="mt-2">
          Enter your mobile number to continue. We'll send you a one-time
          password to verify it.
        </Text>

        <View className="mt-8">
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
        </View>

        <Button
          title="Continue"
          className="mt-6"
          loading={requestOtp.isPending}
          onPress={onContinue}
        />

        <Text variant="caption" className="mt-4 text-center">
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </Screen>
  );
}
