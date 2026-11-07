import React, {useEffect, useState} from 'react';
import {Alert, Linking, View} from 'react-native';

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
import {GRIEVANCE} from '@config/constants';
import {isValidUpiId} from '@features/collections/domain/upi';
import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {
  APP_LANGUAGE_LABEL,
  appLanguageByLabel,
  SUPPORTED_APP_LANGUAGES,
} from '@features/auth/utils/languagePreference';
import {BusinessSwitcher} from '@features/auth/components/BusinessSwitcher';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {
  getSupportedBiometry,
  PIN_LENGTH,
  useAppLockStore,
} from '@features/security/store/appLock.store';
import {useRestoreStore} from '@features/restore/store/restore.store';
import {useT} from '@/i18n';
import {confirmLogout} from '@features/sync/syncStatus';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';

type PinMode = 'idle' | 'set' | 'confirm';

/** Settings home: security (app lock), language preference, and logout. */
export function SettingsScreen({
  navigation,
}: AppScreenProps<'Settings'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const canManageSettings = can(PERMISSIONS.SETTINGS_MANAGE);
  const enabledOptions = [
    {label: t('common.on'), value: true},
    {label: t('common.off'), value: false},
  ] as const;
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
            t('settings.bioUnavailable'),
            t('settings.bioUnavailableMsg'),
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
      return Alert.alert(t('settings.upiInvalid'), t('settings.upiInvalidMsg'));
    }
    setUpi(upiId, payee.trim() || businessName || '');
    Alert.alert(t('settings.upiSaved'), t('settings.upiSavedMsg'));
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

  const businessId = useAuthStore(s => s.business?.id ?? null);
  const resetRestore = useRestoreStore(s => s.reset);
  const onRestoreData = () => {
    if (!businessId) return;
    Alert.alert(
      t('settings.restoreDataConfirmTitle'),
      t('settings.restoreDataConfirmMsg'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('common.ok'),
          // Clearing the decision makes RootNavigator show the restore flow again.
          onPress: () => resetRestore(businessId),
        },
      ],
    );
  };

  const onLogout = () => {
    confirmLogout(t, logout);
  };

  return (
    <Screen>
      <View className="py-8">
        <BusinessSwitcher />
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
                options={enabledOptions}
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
                  options={enabledOptions}
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
          <Select
            value={APP_LANGUAGE_LABEL[language]}
            options={SUPPORTED_APP_LANGUAGES.map(l => APP_LANGUAGE_LABEL[l])}
            onSelect={label => setLanguage(appLanguageByLabel(label))}
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
              {t('settings.payments')}
            </Text>
            <View className="rounded-2xl border border-border bg-white p-4" style={{gap: 14}}>
              <View>
                <Text className="mb-1.5 text-sm font-semibold text-slate-700">
                  {t('settings.upiLabel')}
                </Text>
                <TextField
                  value={upiId}
                  onChangeText={setUpiId}
                  placeholder={t('settings.upiPlaceholder')}
                  autoCapitalize="none"
                />
              </View>
              <View>
                <Text className="mb-1.5 text-sm font-semibold text-slate-700">
                  {t('settings.payeeLabel')}
                </Text>
                <TextField
                  value={payee}
                  onChangeText={setPayee}
                  placeholder={businessName ?? t('settings.payeePlaceholder')}
                />
              </View>
              <Button title={t('settings.upiSave')} variant="secondary" onPress={onSaveUpi} />
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
        {can(PERMISSIONS.BEATS_MANAGE) ? (
          <Button
            title={t('beats.planTitle')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('BeatPlan')}
          />
        ) : null}
        {can(PERMISSIONS.DATA_VIEW) ? (
          <Button
            title={t('recon.title')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('Reconciliation')}
          />
        ) : null}
        {can(PERMISSIONS.DATA_VIEW) ? (
          <Button
            title={t('close.title')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('DailyClose')}
          />
        ) : null}
        {can(PERMISSIONS.DATA_VIEW) ? (
          <Button
            title={t('stock.title')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('Stock')}
          />
        ) : null}
        {can(PERMISSIONS.DATA_VIEW) ? (
          <Button
            title={t('schemes.title')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('Schemes')}
          />
        ) : null}
        {can(PERMISSIONS.REPORTS_VIEW) ? (
          <Button
            title={t('gst.reportsTitle')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('GstReports')}
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
          title={t('settings.cashCounter')}
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
          title={t('settings.privacyConsent')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('ConsentSettings')}
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
        {canManageSettings ? (
          <Button
            title={t('settings.restoreData')}
            variant="secondary"
            className="mt-3"
            onPress={onRestoreData}
          />
        ) : null}

        {/* Your data & privacy (self-service data rights) */}
        <Text variant="label" className="mt-8 mb-3">
          {t('account.section')}
        </Text>
        <Button
          testID="settings-your-data"
          title={t('yourData.open')}
          variant="secondary"
          className="mb-3"
          onPress={() => navigation.navigate('YourData')}
        />
        {can(PERMISSIONS.ENTRY_EDIT) ? (
          <Button
            testID="settings-import"
            title={t('import.open')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('KhataImport')}
          />
        ) : null}
        <Button
          testID="settings-sync"
          title={t('sync.open')}
          variant="secondary"
          className="mb-3"
          onPress={() => navigation.navigate('SyncStatus')}
        />
        {canManageSettings ? (
          <Button
            title={t('account.editBusiness')}
            variant="secondary"
            className="mb-3"
            onPress={() => navigation.navigate('BusinessEdit')}
          />
        ) : null}
        <Button
          title={t('account.deleteAccount')}
          variant="secondary"
          onPress={() => navigation.navigate('DeleteAccount')}
        />

        {/* Privacy & Grievances — the DPDP data-protection / grievance contact,
            deliberately separate from generic customer support (Help). */}
        <Text variant="label" className="mt-8 mb-3">
          {t('grievance.section')}
        </Text>
        <View className="rounded-2xl border border-border bg-white p-4">
          <Text className="text-base font-semibold text-slate-900">
            {GRIEVANCE.officerName}
          </Text>
          <Text variant="caption" className="mt-1 leading-5">
            {t('grievance.desc')}
          </Text>
          <Text className="mt-2 text-sm font-medium text-primary">
            {GRIEVANCE.email}
          </Text>
          <Button
            title={t('grievance.contact')}
            variant="secondary"
            className="mt-3"
            onPress={() =>
              Linking.openURL(
                `mailto:${GRIEVANCE.email}?subject=${encodeURIComponent(
                  'Privacy / grievance — Bolcash',
                )}`,
              ).catch(() => {})
            }
          />
        </View>
        <Button
          title={t('auth.privacy')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('LegalDoc', {doc: 'privacy'})}
        />
        <Button
          title={t('auth.terms')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('LegalDoc', {doc: 'terms'})}
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
