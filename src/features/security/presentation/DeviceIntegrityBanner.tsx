import React, {useState} from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {isDeviceCompromised} from '@features/security/data/deviceIntegrity';

/**
 * Non-blocking warning shown when the device looks rooted/jailbroken. Dismissible
 * for the session; re-evaluated on next launch. Renders nothing on clean devices.
 */
export function DeviceIntegrityBanner(): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !isDeviceCompromised()) return null;

  return (
    <View className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-sm font-bold text-amber-800">
            ⚠️ Device security warning
          </Text>
          <Text className="mt-1 text-xs text-amber-700">
            This device appears to be rooted or jailbroken. Your saved data may
            be less secure — keep the app updated and avoid storing sensitive
            details here.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss security warning"
          onPress={() => setDismissed(true)}
          hitSlop={8}>
          <Text className="text-base text-amber-700">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
