import React from 'react';
import {ActivityIndicator, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Text} from '@components/ui';
import {APP_CONFIG} from '@config/constants';

/**
 * Branding splash shown while the persisted auth state rehydrates. Purely
 * presentational — RootNavigator decides when to dismiss it.
 */
export function SplashScreen(): React.JSX.Element {
  return (
    <SafeAreaView className="flex-1 bg-primary">
      <View className="flex-1 items-center justify-center px-6">
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-white">
          <Text className="text-3xl">₹</Text>
        </View>
        <Text className="mt-5 text-2xl font-bold text-white">
          {APP_CONFIG.name}
        </Text>
        <Text className="mt-1 text-sm text-white/80">
          Smart books for growing businesses
        </Text>
      </View>
      <View className="items-center pb-10">
        <ActivityIndicator color="#FFFFFF" />
      </View>
    </SafeAreaView>
  );
}
