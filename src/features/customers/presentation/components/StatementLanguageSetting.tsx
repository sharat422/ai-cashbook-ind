import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import React from 'react';
import {Alert, View} from 'react-native';

import {Select, Text} from '@components/ui';
import {APP_LANGUAGE_LABEL, SUPPORTED_APP_LANGUAGES, type AppLanguage} from '@features/auth/utils/languagePreference';
import {statementsRemote} from '@features/customers/data/statements.remote';
import {useT} from '@/i18n';

const KEY = ['statement-language'];

/** Owner (Settings): the language of retailer statements unless a retailer has
 *  their own. Telugu first. Only reviewed translations are used; English otherwise. */
export function StatementLanguageSetting(): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const current = useQuery({queryKey: KEY, queryFn: statementsRemote.businessLanguage});
  const save = useMutation({
    mutationFn: (language: string) => statementsRemote.setBusinessLanguage(language),
    onSuccess: data => qc.setQueryData(KEY, data),
    onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message),
  });
  return (
    <View testID="statement-language-default" className="mt-3 rounded-2xl border border-border bg-white p-4">
      <Select
        label={t('settings.statementLanguage')}
        value={(current.data?.language ?? 'te') as AppLanguage}
        options={SUPPORTED_APP_LANGUAGES}
        labelOf={code => APP_LANGUAGE_LABEL[code]}
        onSelect={code => save.mutate(code)}
      />
      <Text variant="caption" className="mt-1">{t('statement.languageHint')}</Text>
    </View>
  );
}
