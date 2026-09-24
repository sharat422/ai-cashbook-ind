import React from 'react';
import {Alert, Pressable, View} from 'react-native';

import {Button, ErrorState, Screen, Text} from '@components/ui';
import {ConsentRow} from '@features/consent/presentation/components/ConsentRow';
import {
  CONSENT_COPY,
  type ConsentPurpose,
  type ConsentState,
} from '@features/consent/domain/entities';
import {
  useConsents,
  useUpdateConsents,
} from '@features/consent/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/**
 * Settings → Privacy & consent: see every purpose and change each one
 * independently. Optional purposes have an explicit Withdraw action (with a
 * confirm) in addition to the toggle; the required purpose is shown locked-on.
 */
export function ConsentSettingsScreen({
  navigation,
}: AppScreenProps<'ConsentSettings'>): React.JSX.Element {
  const t = useT();
  const {data, isLoading, isError, refetch} = useConsents();
  const update = useUpdateConsents();

  const setPurpose = (purpose: ConsentPurpose, granted: boolean) =>
    update.mutate([{purpose, granted}], {
      onError: err => Alert.alert(t('consent.saveErrorTitle'), err.message),
    });

  const confirmWithdraw = (purpose: ConsentPurpose) => {
    const msg =
      purpose === 'ai' ? t('consent.withdrawAiMsg') : t('consent.withdrawMsg');
    Alert.alert(t('consent.withdrawTitle'), msg, [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('consent.withdraw'),
        style: 'destructive',
        onPress: () => setPurpose(purpose, false),
      },
    ]);
  };

  const lastUpdated = (c: ConsentState): string | null =>
    c.updatedAt
      ? t('consent.lastUpdated', {
          date: new Date(c.updatedAt).toLocaleDateString(),
        })
      : null;

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">{t('consent.settingsTitle')}</Text>
        <Text variant="subtitle" className="mt-1">
          {t('consent.settingsSubtitle')}
        </Text>

        {isLoading ? (
          <Text className="mt-6 text-sm text-muted">{t('common.loading')}</Text>
        ) : isError || !data ? (
          <View className="mt-6">
            <ErrorState
              message={t('consent.loadError')}
              onRetry={() => refetch()}
            />
          </View>
        ) : (
          <View className="mt-6" style={{gap: 12}}>
            {data.consents.map((c: ConsentState) => (
              <View key={c.purpose} style={{gap: 6}}>
                <ConsentRow
                  title={t(CONSENT_COPY[c.purpose].title)}
                  description={t(CONSENT_COPY[c.purpose].description)}
                  value={c.granted}
                  required={c.required}
                  requiredLabel={t('consent.required')}
                  onValueChange={
                    c.required ? undefined : next => setPurpose(c.purpose, next)
                  }
                  lastUpdatedLabel={lastUpdated(c)}
                />
                {!c.required && c.granted ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => confirmWithdraw(c.purpose)}
                    className="self-start px-1 py-1">
                    <Text className="text-sm font-semibold text-red-600">
                      {t('consent.withdraw')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}

            <Text className="mt-2 text-xs text-slate-400">
              {t('consent.policyVersionLabel', {version: data.policyVersion})}
            </Text>
          </View>
        )}

        <Button
          title={t('common.done')}
          variant="ghost"
          className="mt-8"
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  );
}
