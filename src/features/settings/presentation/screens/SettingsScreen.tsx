import React, {useEffect, useState} from 'react';
import {Alert, View} from 'react-native';

import {
  Button,
  OtpInput,
  Screen,
  SegmentedControl,
  Select,
  Text,
} from '@components/ui';
import {
  VOICE_LANGUAGES,
  voiceLanguageByLabel,
  voiceLanguageLabel,
  useVoiceSettingsStore,
} from '@features/settings/store/voiceSettings.store';
import {TextField} from '@components/form';
import {isValidUpiId} from '@features/collections/domain/upi';
import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {
  APP_LANGUAGE_LABEL,
  SUPPORTED_APP_LANGUAGES,
} from '@features/auth/utils/languagePreference';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {
  getSupportedBiometry,
  PIN_LENGTH,
  useAppLockStore,
} from '@features/security/store/appLock.store';
import {useT} from '@/i18n';
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
  const t = useT();
  const {can} = usePermissions();
  const canManageSettings = can(PERMISSIONS.SETTINGS_MANAGE);
  const voiceLanguage = useVoiceSettingsStore(s => s.language);
  const setVoiceLanguage = useVoiceSettingsStore(s => s.setLanguage);
  const lockEnabled = useAppLockStore(s => s.enabled);
  const setPin = useAppLockStore(s => s.setPin);
  const disableLock = useAppLockStore(s => s.disableLock);
  const biometricEnabled = useAppLockStore(s => s.biometricEnabled);
  const enableBiometric = useAppLockStore(s => s.enableBiometric);
  const disableBiometric = useAppLockStore(s => s.disableBiometric);
  const [biometrySupported, setBiometrySupported] = useState(false);

  useEffect(() => {
    getSupportedBiometry().then(type => setBiometrySupported(!!type));
  }, []);

  const onToggleBiometric = (value: boolean) => {
    if (value) {
      enableBiometric().then(ok => {
        if (!ok) {
          Alert.alert(
            'Biometrics unavailable',
            'No fingerprint or face unlock is set up on this device.',
          );
        }
      });
    } else {
      void disableBiometric();
    }
  };

  const language = useAuthStore(s => s.preferredLanguage);
  const setLanguage = useAuthStore(s => s.setPreferredLanguage);
  const logout = useAuthStore(s => s.logout);
  const businessName = useAuthStore(s => s.business?.businessName);

  const savedUpi = useCollectionSettingsStore(s => s.upiId);
  const savedPayee = useCollectionSettingsStore(s => s.payeeName);
  const setUpi = useCollectionSettingsStore(s => s.setUpi);
  const [upiId, setUpiId] = useState(savedUpi);
  const [payee, setPayee] = useState(savedPayee);

  const onSaveUpi = () => {
    if (upiId.trim() && !isValidUpiId(upiId)) {
      return Alert.alert('Invalid UPI ID', 'Use the form name@bank, e.g. shop@okhdfcbank.');
    }
    setUpi(upiId, payee.trim() || businessName || '');
    Alert.alert('Saved', 'Your UPI collection details are updated.');
  };

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
      setPin(pin)
        .then(() => {
          cancelPinSetup();
          Alert.alert(
            t('settings.appLockEnabled'),
            t('settings.appLockEnabledMsg'),
          );
        })
        .catch(() => {
          setError('Could not save your PIN securely. Please try again.');
          setPinInput('');
        });
    } else {
      setError(t('settings.pinMismatch'));
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
      Alert.alert(t('settings.turnOffLock'), t('settings.turnOffLockMsg'), [
        {text: t('common.cancel'), style: 'cancel'},
        {text: t('settings.turnOff'), style: 'destructive', onPress: disableLock},
      ]);
    }
  };

  const onLogout = () => {
    Alert.alert(t('common.logoutConfirmTitle'), t('common.logoutConfirmMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('common.logout'), style: 'destructive', onPress: logout},
    ]);
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">{t('settings.title')}</Text>

        {/* Security */}
        <Text variant="label" className="mt-8 mb-3">
          {t('settings.security')}
        </Text>
        <View className="rounded-2xl border border-border bg-white p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-base font-semibold text-slate-900">
                {t('settings.appLock')}
              </Text>
              <Text variant="caption" className="mt-0.5">
                {t('settings.appLockDesc', {n: PIN_LENGTH})}
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
                {mode === 'set' ? t('settings.setPin') : t('settings.confirmPin')}
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
                title={t('common.cancel')}
                variant="ghost"
                className="mt-3"
                onPress={cancelPinSetup}
              />
            </View>
          ) : null}

          {/* Biometric unlock — only when the lock is on and the device supports it */}
          {lockEnabled && biometrySupported ? (
            <View className="mt-5 flex-row items-center justify-between border-t border-border pt-5">
              <View className="flex-1 pr-3">
                <Text className="text-base font-semibold text-slate-900">
                  {t('settings.biometricUnlock')}
                </Text>
                <Text variant="caption" className="mt-0.5">
                  {t('settings.biometricUnlockDesc')}
                </Text>
              </View>
              <View className="w-28">
                <SegmentedControl
                  value={biometricEnabled}
                  options={ENABLED_OPTIONS}
                  onChange={onToggleBiometric}
                />
              </View>
            </View>
          ) : null}
        </View>

        {/* Plain-language explanation of what's actually in place. Every line
            below reflects a real, verified practice — no certification claims. */}
        <View className="mt-3 rounded-2xl border border-border bg-white p-4">
          <Text className="text-base font-semibold text-slate-900">
            {t('settings.securityInfoTitle')}
          </Text>
          <View className="mt-3" style={{gap: 12}}>
            {[
              {icon: '🔒', text: t('settings.securityInfoTransit')},
              {icon: '📱', text: t('settings.securityInfoLock')},
              {icon: '👤', text: t('settings.securityInfoIsolation')},
              {icon: '⚠️', text: t('settings.securityInfoDevice')},
            ].map(row => (
              <View key={row.icon} className="flex-row">
                <Text className="mr-2 text-base">{row.icon}</Text>
                <Text variant="caption" className="flex-1 leading-5">
                  {row.text}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="caption" className="mt-4 border-t border-border pt-3 italic">
            {t('settings.securityInfoNote')}
          </Text>
        </View>

        {/* Preferences */}
        <Text variant="label" className="mt-8 mb-3">
          {t('settings.preferences')}
        </Text>
        <View className="rounded-2xl border border-border bg-white p-4">
          <Text className="mb-2 text-base font-semibold text-slate-900">
            {t('settings.contentLanguage')}
          </Text>
          <SegmentedControl
            value={language}
            options={SUPPORTED_APP_LANGUAGES.map(l => ({
              label: APP_LANGUAGE_LABEL[l],
              value: l,
            }))}
            onChange={setLanguage}
          />
          <View className="mt-4 border-t border-border pt-4">
            <Text className="mb-2 text-base font-semibold text-slate-900">
              {t('settings.voiceLanguage')}
            </Text>
            <Text variant="caption" className="mb-2">
              {t('settings.voiceLanguageDesc')}
            </Text>
            <Select
              value={voiceLanguageLabel(voiceLanguage)}
              options={VOICE_LANGUAGES.map(l => l.label)}
              onSelect={label => setVoiceLanguage(voiceLanguageByLabel(label))}
            />
          </View>
        </View>

        {/* Payments / collections — owner-manages business config */}
        {canManageSettings ? (
          <>
            <Text variant="label" className="mt-8 mb-3">
              Payments
            </Text>
            <View className="rounded-2xl border border-border bg-white p-4" style={{gap: 14}}>
              <View>
                <Text className="mb-1.5 text-sm font-semibold text-slate-700">
                  Your UPI ID (for collecting payments)
                </Text>
                <TextField
                  value={upiId}
                  onChangeText={setUpiId}
                  placeholder="e.g. shop@okhdfcbank"
                  autoCapitalize="none"
                />
              </View>
              <View>
                <Text className="mb-1.5 text-sm font-semibold text-slate-700">
                  Payee name
                </Text>
                <TextField
                  value={payee}
                  onChangeText={setPayee}
                  placeholder={businessName ?? 'Your business name'}
                />
              </View>
              <Button title="Save UPI details" variant="secondary" onPress={onSaveUpi} />
            </View>
          </>
        ) : null}

        {/* Business */}
        <Text variant="label" className="mt-8 mb-3">
          {t('settings.business')}
        </Text>
        {can(PERMISSIONS.TEAM_MANAGE) ? (
          <Button
            title={t('settings.team')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('Team')}
          />
        ) : null}
        {canManageSettings ? (
          <Button
            title={t('settings.itemCatalog')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('Items')}
          />
        ) : null}
        <Button
          title="🪙 Cash counter"
          variant="secondary"
          onPress={() => navigation.navigate('CashCounter')}
        />
        <Button
          title={t('settings.notifications')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('Notifications')}
        />
        <Button
          title={t('settings.help')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('Help')}
        />
        <Button
          title={t('settings.diagnostics')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('Diagnostics')}
        />

        <Button
          title={t('common.logout')}
          variant="secondary"
          className="mt-3"
          onPress={onLogout}
        />
      </View>
    </Screen>
  );
}
