import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, Pressable, StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {OtpInput, Text} from '@components/ui';
import {PIN_LENGTH, useAppLockStore} from '@features/security/store/appLock.store';
import {syncCountsNow} from '@features/sync/syncStatus';
import {useT} from '@/i18n';
import {useAuthStore} from '@store/auth.store';

/**
 * Full-screen lock overlay. Rendered on top of the app when the lock is active;
 * the app stays mounted underneath (state preserved) but hidden until the
 * correct PIN — or a biometric check — succeeds.
 */
export function UnlockScreen(): React.JSX.Element {
  const t = useT();
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const biometricEnabled = useAppLockStore(s => s.biometricEnabled);
  const unlockWithBiometrics = useAppLockStore(s => s.unlockWithBiometrics);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const disableLock = useAppLockStore(s => s.disableLock);
  const loggedIn = useAuthStore(s => !!s.token);
  const logout = useAuthStore(s => s.logout);

  /**
   * Forgot the PIN: the lock is turned off and the person must log in again
   * with the OTP sent to the registered mobile — the same check as every app
   * start. Logged in (the lock came up after the app was in the background):
   * this also logs out, which deletes entries waiting to sync, so say how many.
   */
  const onForgot = () => {
    const c = syncCountsNow();
    const unsynced = loggedIn ? c.pending + c.failed + c.conflicts : 0;
    Alert.alert(
      t('unlock.forgotTitle'),
      unsynced > 0 ? `${t('unlock.forgotMsg')}\n\n${t('unlock.forgotUnsynced', {count: unsynced})}` : t('unlock.forgotMsg'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('unlock.forgotConfirm'),
          style: 'destructive',
          onPress: () => {
            void disableLock();
            if (loggedIn) logout();
          },
        },
      ],
    );
  };

  const tryBiometric = useCallback(async () => {
    if (!biometricEnabled) return;
    await unlockWithBiometrics();
    // On success the store flips `locked` → false and this overlay unmounts.
  }, [biometricEnabled, unlockWithBiometrics]);

  // Offer biometrics automatically as the lock appears.
  const prompted = useRef(false);
  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    void tryBiometric();
  }, [tryBiometric]);

  useEffect(() => {
    if (pin.length < PIN_LENGTH || checking) return;
    setChecking(true);
    let cancelled = false;
    verifyPin(pin)
      .then(ok => {
        if (cancelled) return;
        if (!ok) {
          setError(true);
          setPin('');
        }
      })
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [pin, verifyPin, checking]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.fill]}>
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center px-8">
          <View className="h-16 w-16 items-center justify-center rounded-3xl bg-primary">
            <Text className="text-3xl">🔒</Text>
          </View>
          <Text className="mt-6 text-2xl font-extrabold tracking-tight text-slate-900">
            {t('unlock.title')}
          </Text>
          <Text className="mt-2 text-center text-base text-muted">
            {t('unlock.subtitle', {n: PIN_LENGTH})}
          </Text>

          <View className="mt-8 w-56">
            <OtpInput
              value={pin}
              onChange={value => {
                setPin(value);
                if (error) setError(false);
              }}
              length={PIN_LENGTH}
            />
          </View>
          {error ? (
            <Text className="mt-4 text-sm font-medium text-danger">
              {t('unlock.incorrect')}
            </Text>
          ) : null}

          <Pressable testID="unlock-forgot" accessibilityRole="button" onPress={onForgot} hitSlop={8} className="mt-5">
            <Text className="text-sm font-semibold text-primary">{t('unlock.forgot')}</Text>
          </Pressable>

          {biometricEnabled ? (
            <Pressable
              accessibilityRole="button"
              onPress={tryBiometric}
              className="mt-8 flex-row items-center rounded-xl border border-border bg-white px-5 py-3"
              style={{gap: 8}}>
              <Text className="text-xl">👆</Text>
              <Text className="text-base font-semibold text-primary">
                {t('unlock.useBiometrics')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque so the app underneath is fully hidden while locked.
  fill: {backgroundColor: '#F5F6FF', zIndex: 1000, elevation: 1000},
});
