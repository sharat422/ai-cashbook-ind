import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {TextField} from '@components/form';
import {deleteAccount} from '@/api/auth.api';
import {ApiError, NetworkError} from '@/api/client';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {resetBusinessData} from '@store/sessionReset';

/** Typed confirmation word — must match settings.deleteAccountPlaceholder. */
const CONFIRM_WORD = 'DELETE';

/**
 * Irreversible account deletion.
 *
 * Flow: typed confirmation (DELETE) -> system Alert double-confirm ->
 * DELETE /api/v1/users/me -> on 204, wipe device-local business data and
 * clear the session. RootNavigator routes back to the login stack as soon as
 * the token clears, so no manual navigation reset is needed.
 */
export function DeleteAccountScreen({
  navigation,
}: AppScreenProps<'DeleteAccount'>): React.JSX.Element {
  const t = useT();
  const [input, setInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = input.trim() === CONFIRM_WORD;

  /** Clear every local trace of the account, then sign out. */
  const wipeAndLogout = () => {
    resetBusinessData();
    useAuthStore.getState().logout();
  };

  const doDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      setDeleting(false);
      Alert.alert(
        t('settings.deleteAccountDoneTitle'),
        t('settings.deleteAccountDoneMsg'),
        [{text: t('common.ok'), onPress: wipeAndLogout}],
      );
    } catch (err) {
      setDeleting(false);
      if (err instanceof ApiError && err.status === 401) {
        // Token is no longer valid — we can't confirm server-side deletion,
        // so clear local data and let the user sign in again to retry.
        Alert.alert(
          t('settings.deleteAccountSessionTitle'),
          t('settings.deleteAccountSessionMsg'),
          [{text: t('common.ok'), onPress: wipeAndLogout}],
        );
        return;
      }
      setError(
        err instanceof NetworkError
          ? err.message
          : t('settings.deleteAccountError'),
      );
    }
  };

  const onPressDelete = () => {
    if (!confirmed) {
      setError(t('settings.deleteAccountMismatch'));
      return;
    }
    // Second, explicit confirmation before anything irreversible happens.
    Alert.alert(
      t('settings.deleteAccountFinalTitle'),
      t('settings.deleteAccountFinalMsg'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {text: t('common.delete'), style: 'destructive', onPress: doDelete},
      ],
    );
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">{t('settings.deleteAccountTitle')}</Text>
        <Text className="mt-3 text-base leading-6 text-slate-700">
          {t('settings.deleteAccountIntro')}
        </Text>

        <Text className="mt-8 mb-2 text-base font-semibold text-slate-900">
          {t('settings.deleteAccountTypeLabel')}
        </Text>
        <TextField
          value={input}
          onChangeText={value => {
            setInput(value);
            if (error) setError(null);
          }}
          placeholder={t('settings.deleteAccountPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          editable={!deleting}
        />
        {error ? (
          <Text className="mt-3 text-sm text-danger">{error}</Text>
        ) : null}

        <Button
          title={t('settings.deleteAccount')}
          variant="danger"
          className="mt-6"
          disabled={!confirmed}
          loading={deleting}
          onPress={onPressDelete}
        />
        <Button
          title={t('common.cancel')}
          variant="ghost"
          className="mt-2"
          disabled={deleting}
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  );
}
