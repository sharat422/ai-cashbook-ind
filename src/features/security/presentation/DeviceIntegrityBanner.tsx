import React, {useState} from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {useT} from '@/i18n';
import {reportDeviceIntegrity} from '@features/security/data/deviceIntegrity';

/**
 * Non-blocking warning shown when the device looks rooted/jailbroken. Dismissible
 * for the session; re-evaluated on next launch. Renders nothing on clean devices.
 * Uses `reportDeviceIntegrity` so a detection is also logged once per session.
 */
export function DeviceIntegrityBanner(): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const t = useT();
  if (dismissed || !reportDeviceIntegrity()) return null;

  return (
    <View className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-sm font-bold text-amber-800">
            {t('security.rootedTitle')}
          </Text>
          <Text className="mt-1 text-xs text-amber-700">
            {t('security.rootedBody')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('security.rootedDismiss')}
          onPress={() => setDismissed(true)}
          hitSlop={8}>
          <Text className="text-base text-amber-700">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
