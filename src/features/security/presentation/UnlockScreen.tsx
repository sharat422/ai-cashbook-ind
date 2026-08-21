import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {OtpInput, Text} from '@components/ui';
import {PIN_LENGTH, useAppLockStore} from '@features/security/store/appLock.store';

/**
 * Full-screen lock overlay. Rendered on top of the app when the lock is active;
 * the app stays mounted underneath (state preserved) but hidden until the
 * correct PIN is entered.
 */
export function UnlockScreen(): React.JSX.Element {
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (pin.length < PIN_LENGTH) return;
    if (!verifyPin(pin)) {
      setError(true);
      setPin('');
    }
    // On success the store flips `locked` → false and this overlay unmounts.
  }, [pin, verifyPin]);

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
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque so the app underneath is fully hidden while locked.
  fill: {backgroundColor: '#F8FAFC', zIndex: 1000, elevation: 1000},
});
