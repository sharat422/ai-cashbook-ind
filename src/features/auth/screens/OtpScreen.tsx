import React, {useEffect, useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {Button, OtpInput, Screen, Text} from '@components/ui';
import {MOCK_OTP} from '@api/auth.api';
import {APP_CONFIG} from '@config/constants';
import {useRequestOtp, useVerifyOtp} from '@features/auth/hooks';
import type {AuthScreenProps} from '@navigation/types';
import {validateOtp} from '@utils/validation';

/**
 * Step 2: verify the OTP. On success the auth store gains a token and
 * RootNavigator swaps to the onboarding stack automatically — no manual
 * navigation needed here.
 */
export function OtpScreen({
  route,
  navigation,
}: AuthScreenProps<'Otp'>): React.JSX.Element {
  const {verificationId, mobile} = route.params;
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(
    APP_CONFIG.otpResendSeconds,
  );
  const [activeVerificationId, setActiveVerificationId] =
    useState(verificationId);

  const verifyOtp = useVerifyOtp();
  const requestOtp = useRequestOtp();

  // Resend cooldown countdown.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(
      () => setSecondsLeft(prev => Math.max(0, prev - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const onVerify = () => {
    const validationError = validateOtp(otp, APP_CONFIG.otpLength);
    setError(validationError);
    if (validationError) return;

    verifyOtp.mutate(
      {verificationId: activeVerificationId, mobile, otp},
      {
        onError: err => setError(err.message),
      },
    );
  };

  const onResend = () => {
    requestOtp.mutate(
      {mobile},
      {
        onSuccess: ({verificationId: id}) => {
          setActiveVerificationId(id);
          setOtp('');
          setError(null);
          setSecondsLeft(APP_CONFIG.otpResendSeconds);
          Alert.alert('OTP sent', `A new OTP was sent to +91 ${mobile}.`);
        },
        onError: err => Alert.alert('Could not resend OTP', err.message),
      },
    );
  };

  // Auto-submit once all digits are entered.
  useEffect(() => {
    if (otp.length === APP_CONFIG.otpLength) onVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  return (
    <Screen>
      <View className="flex-1 justify-center py-10">
        <Text variant="title">Verify your number</Text>
        <Text variant="subtitle" className="mt-2">
          Enter the {APP_CONFIG.otpLength}-digit code sent to{' '}
          <Text className="font-semibold text-slate-900">+91 {mobile}</Text>.
        </Text>
        <Pressable className="mt-1" onPress={() => navigation.goBack()}>
          <Text className="text-sm font-semibold text-primary">
            Change number
          </Text>
        </Pressable>

        <View className="mt-8">
          <OtpInput
            value={otp}
            onChange={value => {
              setOtp(value);
              if (error) setError(null);
            }}
            length={APP_CONFIG.otpLength}
          />
          {error ? (
            <Text className="mt-2 text-xs text-danger">{error}</Text>
          ) : null}
          <Text variant="caption" className="mt-3">
            Demo mode: use OTP {MOCK_OTP}
          </Text>
        </View>

        <Button
          title="Verify & Continue"
          className="mt-6"
          loading={verifyOtp.isPending}
          onPress={onVerify}
        />

        <View className="mt-5 flex-row justify-center">
          {secondsLeft > 0 ? (
            <Text variant="caption">
              Resend OTP in {secondsLeft}s
            </Text>
          ) : (
            <Pressable onPress={onResend} disabled={requestOtp.isPending}>
              <Text className="text-sm font-semibold text-primary">
                Resend OTP
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Screen>
  );
}
