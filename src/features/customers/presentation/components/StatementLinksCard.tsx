import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import React from 'react';
import {Alert, View} from 'react-native';

import {Button, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {statementsRemote, type StatementLinkInfo} from '@features/customers/data/statements.remote';
import type {Customer} from '@features/customers/domain/entities';
import {useT} from '@/i18n';
import {formatTimestampDate} from '@utils/date';
import {consentKey} from './StatementConsentCard';

export const linksKey = (customerId: string) => ['statement-links', customerId];
const SHOW = 5;

/** The retailer's statement links: the owner can revoke a live one at once
 *  (it then says "This link has been revoked"). Revoked stays revoked — send
 *  a fresh link instead. An opt-out revokes them all. */
export function StatementLinksCard({customer}: {customer: Customer}): React.JSX.Element | null {
  const t = useT();
  const {can} = usePermissions();
  const qc = useQueryClient();
  const links = useQuery<StatementLinkInfo[]>({
    queryKey: linksKey(customer.id),
    queryFn: () => statementsRemote.links(customer.id),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => statementsRemote.revokeLink(id),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: linksKey(customer.id)});
      qc.invalidateQueries({queryKey: consentKey(customer.id)});
    },
    onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message),
  });
  const ask = (l: StatementLinkInfo) =>
    Alert.alert(t('statement.revokeTitle'), t('statement.revokeMsg', {name: customer.fullName}), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('statement.revoke'), style: 'destructive', onPress: () => revoke.mutate(l.id)},
    ]);

  const rows = (links.data ?? []).slice(0, SHOW);
  if (rows.length === 0) return null;
  return (
    <View testID="statement-links" className="mt-4 rounded-2xl border border-border bg-white p-4" style={{gap: 10}}>
      <Text className="text-sm font-bold text-slate-900">{t('statement.linksTitle')}</Text>
      {rows.map((l: StatementLinkInfo) => (
        <View key={l.id} testID={`link-${l.id}`} className="flex-row items-center justify-between" style={{gap: 8}}>
          <View className="flex-1">
            <Text className="text-sm text-slate-800">{t('statement.linkSent', {date: formatTimestampDate(l.createdAt)})}</Text>
            <Text variant="caption">
              {l.status === 'revoked'
                ? t('statement.linkRevoked', {date: formatTimestampDate(l.revokedAt!)})
                : l.status === 'expired'
                  ? t('statement.linkExpired')
                  : t('statement.linkLive', {date: formatTimestampDate(l.expiresAt)})}
            </Text>
            {l.limitedAt ? (
              <Text testID={`limited-${l.id}`} variant="caption" className="text-amber-700">
                {t('statement.linkLimited', {date: formatTimestampDate(l.limitedAt)})}
              </Text>
            ) : null}
          </View>
          {l.status === 'live' && can(PERMISSIONS.ENTRY_EDIT) ? (
            <Button testID={`revoke-${l.id}`} title={t('statement.revoke')} variant="secondary"
              loading={revoke.isPending && revoke.variables === l.id} onPress={() => ask(l)} />
          ) : null}
        </View>
      ))}
    </View>
  );
}
