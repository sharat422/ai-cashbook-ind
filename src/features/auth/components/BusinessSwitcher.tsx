import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {Alert, View} from 'react-native';

import {listMyBusinesses, openBusiness, type BusinessChoice} from '@api/auth.api';
import {Button, Text} from '@components/ui';
import {syncCountsNow} from '@features/sync/syncStatus';
import {useT, type TKey} from '@/i18n';
import {useAuthStore} from '@store/auth.store';

/** Shown only to someone assigned to more than one business (e.g. a CA). */
export function BusinessSwitcher(): React.JSX.Element | null {
  const t = useT();
  const current = useAuthStore(s => s.business);
  const setBusiness = useAuthStore(s => s.setBusiness);
  const {data} = useQuery<BusinessChoice[]>({queryKey: ['my-businesses'], queryFn: listMyBusinesses});
  if (!data || data.length < 2) return null;

  const open = async (id: string) => {
    const c = syncCountsNow();
    // Switching clears this phone's queues (they belong to the old business).
    if (c.pending + c.failed + c.conflicts > 0) {
      Alert.alert(t('switch.blockedTitle'), t('switch.blockedMsg'));
      return;
    }
    try {
      setBusiness(await openBusiness(id));
    } catch (e) {
      Alert.alert(t('switch.failed'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    }
  };

  return (
    <View className="mb-4">
      <Text variant="label" className="mb-2">{t('switch.heading')}</Text>
      {data.map((b: BusinessChoice) => (
        <Button
          key={b.id}
          testID={`switch-${b.id}`}
          title={`${b.id === current?.id ? '✓ ' : ''}${b.businessName} · ${t(`team.role.${b.role}` as TKey)}`}
          variant={b.id === current?.id ? 'primary' : 'secondary'}
          className="mb-2"
          disabled={b.id === current?.id}
          onPress={() => void open(b.id)}
        />
      ))}
    </View>
  );
}
