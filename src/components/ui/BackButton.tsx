import React, {createContext, useContext} from 'react';
import {Pressable, View} from 'react-native';

import {useT} from '@/i18n';
import {Text} from './Text';

/** The current screen's navigation, given to every screen by the navigators
 *  (`screenLayout` in src/navigation), so the UI kit needn't import React Navigation. */
export const BackContext = createContext<{canGoBack: () => boolean; goBack: () => void} | null>(null);

/**
 * "<" at the top of a screen: back to the previous screen. Shows only when
 * there is one (not on the home screen, nor outside navigation).
 */
export function BackButton(): React.JSX.Element | null {
  const navigation = useContext(BackContext);
  const t = useT();
  if (!navigation?.canGoBack()) return null;
  return (
    <View className="flex-row px-5 pt-2">
      <Pressable
        testID="back-button"
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={12}
        className="h-10 w-10 items-center justify-center rounded-full border border-border bg-white">
        <Text className="text-xl font-semibold text-slate-900">{'<'}</Text>
      </Pressable>
    </View>
  );
}
