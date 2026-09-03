import React from 'react';
import {Alert, ScrollView, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';

/**
 * Home screen for the **staff** role (add-only). Staff can record transactions
 * but have no access to dashboards, lists, reports or settings — so we show a
 * focused set of "add" actions instead of the full dashboard.
 */
export function StaffHome({
  navigation,
}: Pick<AppScreenProps<'Dashboard'>, 'navigation'>): React.JSX.Element {
  const t = useT();
  const business = useAuthStore(s => s.business);
  const logout = useAuthStore(s => s.logout);

  const onLogout = () => {
    Alert.alert(t('common.logoutConfirmTitle'), t('common.logoutConfirmMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('common.logout'), style: 'destructive', onPress: logout},
    ]);
  };

  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}>
        <Text variant="caption">{t('dashboard.welcome')}</Text>
        <Text variant="title" className="mt-1">
          {business?.businessName ?? t('dashboard.yourBusiness')}
        </Text>
        <Text variant="subtitle" className="mt-1">
          {t('staff.subtitle')}
        </Text>

        <View className="mt-8" style={{gap: 12}}>
          <Button
            title={t('dashboard.aiEntry')}
            onPress={() => navigation.navigate('AITransaction')}
          />
          <Button
            title={t('dashboard.addTransaction')}
            onPress={() => navigation.navigate('QuickAdd')}
          />
          <Button
            title={t('dashboard.scanReceipt')}
            variant="secondary"
            onPress={() => navigation.navigate('ReceiptCapture')}
          />
          <Button
            title={t('dashboard.importSms')}
            variant="secondary"
            onPress={() => navigation.navigate('SmsImport')}
          />
        </View>

        <View className="mt-10">
          <Button
            title={t('common.logout')}
            variant="ghost"
            onPress={onLogout}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
