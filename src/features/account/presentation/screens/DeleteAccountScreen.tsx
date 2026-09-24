import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {TextField} from '@components/form';
import {Button, Screen, Text} from '@components/ui';
import {
  accountRemote,
  DELETE_CONFIRMATION,
} from '@features/account/data/account.remote';
import {useAuthStore} from '@store/auth.store';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/**
 * Permanent account deletion. Shows exactly what will be erased, requires the
 * user to type the confirmation phrase, then calls DELETE /account (which
 * really deletes the data server-side and logs the event) and logs out.
 */
export function DeleteAccountScreen({
  navigation,
}: AppScreenProps<'DeleteAccount'>): React.JSX.Element {
  const t = useT();
  const logout = useAuthStore(s => s.logout);
  const [phrase, setPhrase] = useState('');
  const [deleting, setDeleting] = useState(false);

  const confirmed = phrase.trim().toUpperCase() === DELETE_CONFIRMATION;

  const bullets = [
    t('account.deleteItem.business'),
    t('account.deleteItem.transactions'),
    t('account.deleteItem.customers'),
    t('account.deleteItem.irreversible'),
  ];

  const onDelete = () => {
    if (!confirmed) return;
    Alert.alert(t('account.deleteTitle'), t('account.deleteFinalConfirm'), [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('account.deleteButton'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await accountRemote.deleteAccount(phrase.trim().toUpperCase());
            // Data is gone and the token is now invalid — clear the session,
            // which sends the user back to the login screen.
            logout();
          } catch (e) {
            setDeleting(false);
            Alert.alert(
              t('account.deleteErrorTitle'),
              e instanceof Error ? e.message : t('ai.tryAgain'),
            );
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title" className="text-red-600">
          {t('account.deleteTitle')}
        </Text>
        <Text variant="subtitle" className="mt-2">
          {t('account.deleteWarning')}
        </Text>

        <View className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4" style={{gap: 10}}>
          {bullets.map(b => (
            <View key={b} className="flex-row">
              <Text className="mr-2 text-red-600">•</Text>
              <Text className="flex-1 text-sm leading-5 text-red-800">{b}</Text>
            </View>
          ))}
        </View>

        <Text className="mt-6 text-sm font-medium text-slate-700">
          {t('account.deleteTypePhrase', {phrase: DELETE_CONFIRMATION})}
        </Text>
        <View className="mt-2">
          <TextField
            value={phrase}
            onChangeText={setPhrase}
            placeholder={DELETE_CONFIRMATION}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        <Button
          title={t('account.deleteButton')}
          className="mt-6 bg-red-600"
          variant="primary"
          disabled={!confirmed}
          loading={deleting}
          onPress={onDelete}
        />
        <Button
          title={t('common.cancel')}
          variant="ghost"
          className="mt-2"
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  );
}
