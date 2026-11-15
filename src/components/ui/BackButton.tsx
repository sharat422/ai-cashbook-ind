import React, {createContext, useContext} from 'react';
import {Pressable, View} from 'react-native';

import {colors} from '@theme/colors';
import {useT} from '@/i18n';

const CHEVRON = {
  width: 11,
  height: 11,
  marginLeft: 4, // the rotated square's corner is the tip: nudge it to the visual centre
  borderLeftWidth: 2.5,
  borderBottomWidth: 2.5,
  borderColor: colors.text,
  transform: [{rotate: '45deg'}],
} as const;

/** The current screen's navigation, given to every screen by the navigators
 *  (`screenLayout` in src/navigation), so the UI kit needn't import React Navigation. */
export const BackContext = createContext<{canGoBack: () => boolean; goBack: () => void} | null>(null);

/**
 * The back chevron at the top of a screen: back to the previous screen. Shows only when
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
        {/* A drawn chevron: crisp at any size, unlike a "<" character (which reads as less-than). */}
        <View style={CHEVRON} />
      </Pressable>
    </View>
  );
}
