import React, {useEffect, useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {Button, OtpInput, Text} from '@components/ui';
import {AuthShell} from '@features/auth/components/AuthShell';
import {MOCK_OTP} from '@api/auth.api';
import {APP_CONFIG} from '@config/constants';
import {useRequestOtp, useVerifyOtp} from '@features/auth/hooks';
import {useT} from '@/i18n';
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
  const t = useT();
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
          Alert.alert(t('auth.otp.sentTitle'), t('auth.otp.sentMsg', {mobile}));
        },
        onError: err => Alert.alert(t('auth.otp.resendError'), err.message),
      },
    );
  };

  // Auto-submit once all digits are entered.
  useEffect(() => {
    if (otp.length === APP_CONFIG.otpLength) onVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  return (
    <AuthShell
      title={t('auth.otp.title')}
      subtitle={t('auth.otp.subtitle', {n: APP_CONFIG.otpLength, mobile})}
      footer={
        <View className="flex-row items-center justify-center" style={{gap: 6}}>
          {secondsLeft > 0 ? (
            <Text variant="caption">
              {t('auth.otp.resendIn', {n: secondsLeft})}
            </Text>
          ) : (
            <Pressable onPress={onResend} disabled={requestOtp.isPending}>
              <Text className="text-sm font-semibold text-primary">
                {t('auth.otp.resend')}
              </Text>
            </Pressable>
          )}
          <Text variant="caption">·</Text>
          <Pressable onPress={() => navigation.goBack()}>
            <Text className="text-sm font-semibold text-primary">
              {t('auth.otp.changeNumber')}
            </Text>
          </Pressable>
        </View>
      }>
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
      <Text variant="caption" className="mt-3 text-center">
        {t('auth.otp.demo', {otp: MOCK_OTP})}
      </Text>

      <Button
        title={t('auth.otp.verify')}
        className="mt-6"
        loading={verifyOtp.isPending}
        onPress={onVerify}
      />
    </AuthShell>
  );
}
