import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {CUSTOMERS_KEY} from '@features/customers/presentation/hooks/useCustomers';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatTimestamp} from '@utils/date';
import {CONFLICT_FIELDS, resolveConflict, useCustomerEdits} from '../customerEdits';

const LABEL: Record<(typeof CONFLICT_FIELDS)[number], TKey> = {
  fullName: 'customers.fullName',
  mobile: 'customers.mobileNumber',
  businessName: 'customers.businessName',
  gstNumber: 'customers.gst',
  address: 'customers.address',
  notes: 'form.notes',
};

/**
 * The same customer was changed on this phone and on another device. Both
 * versions side by side; nothing is saved until the owner picks one.
 */
export function SyncConflictScreen({navigation, route}: AppScreenProps<'SyncConflict'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const queryClient = useQueryClient();
  const conflict = useCustomerEdits(s => s.conflicts.find(c => c.customerId === route.params.customerId));
  const [busy, setBusy] = useState<'mine' | 'theirs' | null>(null);

  if (!conflict) {
    return (
      <Screen>
        <View className="py-6">
          <Text variant="title">{t('sync.conflictTitle')}</Text>
          <Text variant="subtitle" className="mt-2">{t('sync.conflictNone')}</Text>
          <Button title={t('common.back')} variant="secondary" className="mt-6" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  const choose = async (keep: 'mine' | 'theirs') => {
    setBusy(keep);
    try {
      const result = await resolveConflict(conflict.customerId, keep);
      await queryClient.invalidateQueries({queryKey: [CUSTOMERS_KEY]});
      if (result === 'changedAgain') {
        Alert.alert(t('sync.changedAgainTitle'), t('sync.changedAgainMsg'));
        return;
      }
      navigation.goBack();
    } catch (err) {
      Alert.alert(t('form.couldNotSave'), err instanceof Error ? err.message : t('common.tryAgainMsg'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('sync.conflictTitle')}</Text>
        <Text variant="subtitle" className="mt-1">{t('sync.conflictExplain')}</Text>

        <View className="mt-5 flex-row" style={{gap: 8}}>
          <Text className="flex-1 text-xs font-bold uppercase text-muted">{t('sync.thisPhone')}</Text>
          <Text className="flex-1 text-xs font-bold uppercase text-muted">
            {t('sync.otherDevice')}
          </Text>
        </View>
        {CONFLICT_FIELDS.map(f => {
          const mine = (conflict.mine[f] ?? '').trim();
          const theirs = (conflict.theirs[f] ?? '').trim();
          const differs = mine !== theirs;
          return (
            <View
              key={f}
              testID={`conflict-row-${f}`}
              className={`mt-2 rounded-xl border p-3 ${differs ? 'border-violet-300 bg-violet-50' : 'border-border bg-white'}`}>
              <Text variant="caption">{t(LABEL[f])}{differs ? ` · ${t('sync.different')}` : ''}</Text>
              <View className="mt-1 flex-row" style={{gap: 8}}>
                <Text testID={`mine-${f}`} className="flex-1 text-sm">{mine || '—'}</Text>
                <Text testID={`theirs-${f}`} className="flex-1 text-sm">{theirs || '—'}</Text>
              </View>
            </View>
          );
        })}
        <Text variant="caption" className="mt-3">
          {t('sync.detectedAt', {time: formatTimestamp(conflict.detectedAt)})}
        </Text>

        {can(PERMISSIONS.ENTRY_EDIT) ? (
          <>
            <Button testID="keep-mine" title={t('sync.keepMine')} className="mt-6"
              loading={busy === 'mine'} disabled={busy !== null} onPress={() => choose('mine')} />
            <Button testID="keep-theirs" title={t('sync.keepTheirs')} variant="secondary" className="mt-3"
              loading={busy === 'theirs'} disabled={busy !== null} onPress={() => choose('theirs')} />
          </>
        ) : (
          <Text variant="caption" className="mt-6">{t('sync.ownerMustChoose')}</Text>
        )}
      </View>
    </Screen>
  );
}
