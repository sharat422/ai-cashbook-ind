import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import React from 'react';
import {Alert, View} from 'react-native';

import {Button, Select, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {APP_LANGUAGE_LABEL, SUPPORTED_APP_LANGUAGES, type AppLanguage} from '@features/auth/utils/languagePreference';
import {statementsRemote, type StatementConsent} from '@features/customers/data/statements.remote';
import type {Customer} from '@features/customers/domain/entities';
import {useT} from '@/i18n';
import {formatTimestampDate} from '@utils/date';

export const consentKey = (customerId: string) => ['statement-consent', customerId];

/**
 * The retailer's WhatsApp-statement choice for this distributor. Nothing is
 * assumed from trading together: no record means no. Opt-ins are recorded
 * with an explicit confirmation; the retailer can also opt in or out from
 * their own statement link.
 */
export function StatementConsentCard({customer}: {customer: Customer}): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const qc = useQueryClient();
  const consent = useQuery<StatementConsent>({
    queryKey: consentKey(customer.id),
    queryFn: () => statementsRemote.consent(customer.id),
  });
  const set = useMutation({
    mutationFn: (status: 'opted_in' | 'opted_out') => statementsRemote.setConsent(customer.id, status),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: consentKey(customer.id)});
      qc.invalidateQueries({queryKey: ['statement-links', customer.id]});  // an opt-out revokes them
    },
    onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message),
  });

  const setLanguage = useMutation({
    mutationFn: (language: string | null) => statementsRemote.setLanguage(customer.id, language),
    onSuccess: () => qc.invalidateQueries({queryKey: consentKey(customer.id)}),
    onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message),
  });
  const DEFAULT = 'default';
  const langLabel = (code: string) => APP_LANGUAGE_LABEL[code as AppLanguage] ?? code;

  const data: StatementConsent | undefined = consent.data;
  const status: StatementConsent['status'] = data?.status ?? 'none';
  const source: 'owner' | 'retailer' = data?.source ?? 'owner';
  const askOptIn = () =>
    Alert.alert(t('statement.optInTitle'), t('statement.optInConfirm', {name: customer.fullName}), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('statement.optInYes'), onPress: () => set.mutate('opted_in')},
    ]);

  return (
    <View testID="statement-consent" className="mt-5 rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
      <Text className="text-sm font-bold text-slate-900">{t('statement.whatsappTitle')}</Text>
      <Text className={`text-sm ${status === 'opted_in' ? 'text-green-700' : 'text-slate-700'}`}>
        {t(`statement.consent.${status}`)}
        {data?.since
          ? ` · ${formatTimestampDate(data.since)} · ${t(`statement.by.${source}`)}`
          : ''}
      </Text>
      {can(PERMISSIONS.ENTRY_EDIT) ? (
        status === 'opted_in' ? (
          <Button title={t('statement.recordOptOut')} variant="secondary" loading={set.isPending}
            onPress={() => set.mutate('opted_out')} />
        ) : (
          <Button title={t('statement.recordOptIn')} variant="secondary" loading={set.isPending} onPress={askOptIn} />
        )
      ) : null}
      {data && can(PERMISSIONS.ENTRY_EDIT) ? (
        <View testID="statement-language" className="mt-2">
          <Select
            label={t('statement.language')}
            value={data.language ?? DEFAULT}
            options={[DEFAULT, ...SUPPORTED_APP_LANGUAGES]}
            labelOf={code => (code === DEFAULT
              ? t('statement.languageDefault', {language: langLabel(data.defaultLanguage ?? 'te')})
              : langLabel(code))}
            onSelect={code => setLanguage.mutate(code === DEFAULT ? null : code)}
          />
          <Text variant="caption" className="mt-1">{t('statement.languageHint')}</Text>
        </View>
      ) : null}
    </View>
  );
}
