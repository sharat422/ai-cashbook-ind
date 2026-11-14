import React from 'react';
import {ActivityIndicator, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {BrandLogo, Text} from '@components/ui';
import {useT} from '@/i18n';

/**
 * Branding splash shown while the persisted auth state rehydrates. Purely
 * presentational — RootNavigator decides when to dismiss it.
 */
export function SplashScreen(): React.JSX.Element {
  const t = useT();
  return (
    <SafeAreaView className="flex-1 bg-primary">
      <View className="flex-1 items-center justify-center px-6">
        {/* The logo is orange on white: on a white card over the brand colour. */}
        <View className="items-center rounded-3xl bg-white px-6 py-5">
          <BrandLogo width={240} />
        </View>
        <Text className="mt-4 text-sm text-white/80">
          {t('auth.splash.tagline')}
        </Text>
      </View>
      <View className="items-center pb-10">
        <ActivityIndicator color="#FFFFFF" />
      </View>
    </SafeAreaView>
  );
}
