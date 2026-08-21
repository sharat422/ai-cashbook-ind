import React, {useEffect, useState} from 'react';
import {Alert, View} from 'react-native';

import {
  Button,
  OtpInput,
  Screen,
  SegmentedControl,
  Text,
} from '@components/ui';
import {
  APP_LANGUAGE_LABEL,
  SUPPORTED_APP_LANGUAGES,
} from '@features/auth/utils/languagePreference';
import {PIN_LENGTH, useAppLockStore} from '@features/security/store/appLock.store';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';

const ENABLED_OPTIONS = [
  {label: 'On', value: true},
  {label: 'Off', value: false},
] as const;

type PinMode = 'idle' | 'set' | 'confirm';

/** Settings home: security (app lock), language preference, and logout. */
export function SettingsScreen({
  navigation,
}: AppScreenProps<'Settings'>): React.JSX.Element {
  const lockEnabled = useAppLockStore(s => s.enabled);
  const setPin = useAppLockStore(s => s.setPin);
  const disableLock = useAppLockStore(s => s.disableLock);

  const language = useAuthStore(s => s.preferredLanguage);
  const setLanguage = useAuthStore(s => s.setPreferredLanguage);
  const logout = useAuthStore(s => s.logout);

  const [mode, setMode] = useState<PinMode>('idle');
  const [firstPin, setFirstPin] = useState('');
  const [pin, setPinInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cancelPinSetup = () => {
    setMode('idle');
    setFirstPin('');
    setPinInput('');
    setError(null);
  };

  useEffect(() => {
    if (mode === 'idle' || pin.length < PIN_LENGTH) return;

    if (mode === 'set') {
      setFirstPin(pin);
      setPinInput('');
      setError(null);
      setMode('confirm');
      return;
    }
    // confirm
    if (pin === firstPin) {
      setPin(pin);
      cancelPinSetup();
      Alert.alert('App lock enabled', 'You’ll be asked for this PIN on launch.');
    } else {
      setError('PINs did not match. Start again.');
      setFirstPin('');
      setPinInput('');
      setMode('set');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const onToggleLock = (value: boolean) => {
    if (value && !lockEnabled) {
      setMode('set');
      setPinInput('');
      setError(null);
    } else if (!value && lockEnabled) {
      Alert.alert('Turn off app lock?', 'Your PIN will be removed.', [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Turn off', style: 'destructive', onPress: disableLock},
      ]);
    }
  };

  const onLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Log out', style: 'destructive', onPress: logout},
    ]);
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">Settings</Text>

        {/* Security */}
        <Text variant="label" className="mt-8 mb-3">
          Security
        </Text>
        <View className="rounded-2xl border border-border bg-white p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-base font-semibold text-slate-900">
                App lock
              </Text>
              <Text variant="caption" className="mt-0.5">
                Require a {PIN_LENGTH}-digit PIN to open the app.
              </Text>
            </View>
            <View className="w-28">
              <SegmentedControl
                value={lockEnabled}
                options={ENABLED_OPTIONS}
                onChange={onToggleLock}
              />
            </View>
          </View>

          {mode !== 'idle' ? (
            <View className="mt-5 border-t border-border pt-5">
              <Text className="text-center text-base font-semibold text-slate-900">
                {mode === 'set' ? 'Set a PIN' : 'Confirm your PIN'}
              </Text>
              <View className="mt-4 self-center" style={{width: 224}}>
                <OtpInput
                  value={pin}
                  onChange={value => {
                    setPinInput(value);
                    if (error) setError(null);
                  }}
                  length={PIN_LENGTH}
                />
              </View>
              {error ? (
                <Text className="mt-3 text-center text-sm text-danger">
                  {error}
                </Text>
              ) : null}
              <Button
                title="Cancel"
                variant="ghost"
                className="mt-3"
                onPress={cancelPinSetup}
              />
            </View>
          ) : null}
        </View>

        {/* Preferences */}
        <Text variant="label" className="mt-8 mb-3">
          Preferences
        </Text>
        <View className="rounded-2xl border border-border bg-white p-4">
          <Text className="mb-2 text-base font-semibold text-slate-900">
            Content language
          </Text>
          <SegmentedControl
            value={language}
            options={SUPPORTED_APP_LANGUAGES.map(l => ({
              label: APP_LANGUAGE_LABEL[l],
              value: l,
            }))}
            onChange={setLanguage}
          />
        </View>

        {/* Business */}
        <Text variant="label" className="mt-8 mb-3">
          Business
        </Text>
        <Button
          title="🏷️ Item catalog"
          variant="secondary"
          onPress={() => navigation.navigate('Items')}
        />
        <Button
          title="🔔 Notifications"
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('Notifications')}
        />

        <Button
          title="Log out"
          variant="secondary"
          className="mt-3"
          onPress={onLogout}
        />
      </View>
    </Screen>
  );
}
