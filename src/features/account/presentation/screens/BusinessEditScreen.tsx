import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {Button, Input, Screen, SegmentedControl, Select, Text} from '@components/ui';
import {BUSINESS_TYPES, INDIAN_STATES} from '@config/constants';
import {accountRemote} from '@features/account/data/account.remote';
import {useAuthStore} from '@store/auth.store';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/**
 * Correct your own business/account details (name, owner, type, state, GST).
 * Owner-only on the server (SETTINGS_MANAGE); saves via PATCH /businesses/me and
 * updates the local session so the change shows immediately.
 */
export function BusinessEditScreen({
  navigation,
}: AppScreenProps<'BusinessEdit'>): React.JSX.Element {
  const t = useT();
  const business = useAuthStore(s => s.business);
  const setBusiness = useAuthStore(s => s.setBusiness);

  const [businessName, setBusinessName] = useState(business?.businessName ?? '');
  const [ownerName, setOwnerName] = useState(business?.ownerName ?? '');
  const [businessType, setBusinessType] = useState<string | null>(
    business?.businessType ?? null,
  );
  const [state, setState] = useState<string | null>(business?.state ?? null);
  const [gstRegistered, setGstRegistered] = useState<boolean>(
    business?.gstRegistered ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    if (!businessName.trim() || !ownerName.trim()) {
      setError(t('account.editRequired'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const updated = await accountRemote.updateBusiness({
        businessName: businessName.trim(),
        ownerName: ownerName.trim(),
        businessType: businessType ?? undefined,
        state: state ?? undefined,
        gstRegistered,
      });
      setBusiness(updated);
      navigation.goBack();
    } catch (e) {
      Alert.alert(
        t('form.couldNotSave'),
        e instanceof Error ? e.message : t('ai.tryAgain'),
      );
    } finally {
      setSaving(false);
    }
  };

  const GST_OPTIONS = [
    {label: t('common.yes'), value: true},
    {label: t('common.no'), value: false},
  ] as const;

  return (
    <Screen>
      <View className="py-8" style={{gap: 18}}>
        <Text variant="title">{t('account.editTitle')}</Text>

        <Input
          label={t('auth.business.nameLabel')}
          value={businessName}
          onChangeText={v => {
            setBusinessName(v);
            if (error) setError(null);
          }}
          error={error && !businessName.trim() ? error : null}
        />
        <Input
          label={t('auth.business.ownerLabel')}
          value={ownerName}
          onChangeText={v => {
            setOwnerName(v);
            if (error) setError(null);
          }}
          error={error && !ownerName.trim() ? error : null}
        />
        <Select
          label={t('auth.business.typeLabel')}
          placeholder={t('auth.business.typePlaceholder')}
          options={BUSINESS_TYPES as unknown as string[]}
          value={businessType}
          onSelect={setBusinessType}
        />
        <Select
          label={t('auth.business.stateLabel')}
          placeholder={t('auth.business.statePlaceholder')}
          options={INDIAN_STATES as unknown as string[]}
          value={state}
          onSelect={setState}
        />
        <SegmentedControl
          label={t('auth.business.gstLabel')}
          options={GST_OPTIONS}
          value={gstRegistered}
          onChange={setGstRegistered}
        />

        <Button
          title={t('common.save')}
          className="mt-2"
          loading={saving}
          onPress={onSave}
        />
        <Button
          title={t('common.cancel')}
          variant="ghost"
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  );
}
