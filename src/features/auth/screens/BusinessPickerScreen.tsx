import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {openBusiness, type BusinessChoice} from '@api/auth.api';
import {Screen, Text} from '@components/ui';
import {useLastBusiness} from '@features/auth/store/lastBusiness.store';
import {useT, type TKey} from '@/i18n';
import {useAuthStore} from '@store/auth.store';
import {formatTimestampDate} from '@utils/date';

/**
 * AC3: after login, someone with more than one business (a CA serving several
 * owners) picks which to open. Only businesses that assigned them are listed
 * (the server's active memberships). The one last chosen on this phone comes
 * first. Settings still switches afterwards.
 */
export function BusinessPickerScreen(): React.JSX.Element {
  const t = useT();
  const userId = useAuthStore(s => s.user?.id ?? '');
  const choices = useAuthStore(s => s.businessChoices) ?? [];
  const setBusiness = useAuthStore(s => s.setBusiness);
  const remembered = useLastBusiness(s => s.byUser[userId]);
  const remember = useLastBusiness(s => s.remember);
  const [opening, setOpening] = useState<string | null>(null);
  const ordered = [...choices].sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered));

  const open = async (b: BusinessChoice) => {
    setOpening(b.id);
    try {
      const business = await openBusiness(b.id); // the server re-checks the membership
      remember(userId, b.id);
      setBusiness(business);
    } catch (e) {
      Alert.alert(t('switch.failed'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setOpening(null);
    }
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('picker.title')}</Text>
        <Text variant="subtitle" className="mt-1 mb-4">{t('picker.subtitle', {count: choices.length})}</Text>
        {ordered.map(b => (
          <Pressable key={b.id} testID={`pick-${b.id}`} accessibilityRole="button" disabled={opening !== null}
            onPress={() => void open(b)}
            className={`mb-3 rounded-2xl border p-4 ${b.id === remembered ? 'border-primary bg-white' : 'border-border bg-white'}`}>
            <Text className="text-base font-semibold">{b.businessName}</Text>
            {b.ownerName ? <Text variant="caption">{t('picker.owner', {name: b.ownerName})}</Text> : null}
            <Text variant="caption">
              {t(`team.role.${b.role}` as TKey)} · {b.lastOpenedAt
                ? t('picker.lastOpened', {date: formatTimestampDate(b.lastOpenedAt)})
                : t('picker.neverOpened')}
            </Text>
            {b.id === remembered ? <Text className="mt-1 text-xs font-semibold text-primary">{t('picker.lastOnThisPhone')}</Text> : null}
            {opening === b.id ? <Text variant="caption">{t('common.loading')}</Text> : null}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
