import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {OtpInput, Text} from '@components/ui';
import {PIN_LENGTH, useAppLockStore} from '@features/security/store/appLock.store';

/**
 * Full-screen lock overlay. Rendered on top of the app when the lock is active;
 * the app stays mounted underneath (state preserved) but hidden until the
 * correct PIN — or a biometric check — succeeds.
 */
export function UnlockScreen(): React.JSX.Element {
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const biometricEnabled = useAppLockStore(s => s.biometricEnabled);
  const unlockWithBiometrics = useAppLockStore(s => s.unlockWithBiometrics);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

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
            Enter your PIN
          </Text>
          <Text className="mt-2 text-center text-base text-muted">
            Smart CashBook is locked. Enter your {PIN_LENGTH}-digit PIN to
            continue.
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
              Incorrect PIN. Try again.
            </Text>
          ) : null}

          {biometricEnabled ? (
            <Pressable
              accessibilityRole="button"
              onPress={tryBiometric}
              className="mt-8 flex-row items-center rounded-xl border border-border bg-white px-5 py-3"
              style={{gap: 8}}>
              <Text className="text-xl">👆</Text>
              <Text className="text-base font-semibold text-primary">
                Use biometrics
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
  fill: {backgroundColor: '#F8FAFC', zIndex: 1000, elevation: 1000},
});
