import React, {useRef, useState} from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Button, Text} from '@components/ui';
import {useT} from '@/i18n';
import type {TKey} from '@/i18n';

const {width} = Dimensions.get('window');

interface Slide {
  glyph: string;
  titleKey: TKey;
  bodyKey: TKey;
}

const SLIDES: Slide[] = [
  {glyph: '📒', titleKey: 'onboarding.s1Title', bodyKey: 'onboarding.s1Body'},
  {glyph: '🎤', titleKey: 'onboarding.s2Title', bodyKey: 'onboarding.s2Body'},
  {glyph: '📊', titleKey: 'onboarding.s3Title', bodyKey: 'onboarding.s3Body'},
];

/**
 * First-run welcome carousel. Shown once (see onboarding.store) before Login.
 * `onDone` records that it's been seen and lets RootNavigator fall through to
 * the auth flow. Rendered outside the NavigationContainer, so it has no route.
 */
export function WelcomeScreen({onDone}: {onDone: () => void}): React.JSX.Element {
  const t = useT();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const isLast = index === SLIDES.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  const onNext = () => {
    if (isLast) return onDone();
    listRef.current?.scrollToOffset({offset: (index + 1) * width, animated: true});
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Skip */}
      <View className="h-12 flex-row items-center justify-end px-5">
        <Pressable accessibilityRole="button" onPress={onDone} hitSlop={10}>
          <Text className="text-sm font-semibold text-muted">
            {t('onboarding.skip')}
          </Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={s => s.titleKey}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        renderItem={({item}) => (
          <View style={{width}} className="flex-1 items-center justify-center px-8">
            <Text className="text-[88px]">{item.glyph}</Text>
            <Text
              variant="title"
              className="mt-6 text-center text-2xl font-extrabold text-slate-900">
              {t(item.titleKey)}
            </Text>
            <Text className="mt-3 max-w-xs text-center text-base leading-6 text-muted">
              {t(item.bodyKey)}
            </Text>
          </View>
        )}
      />

      {/* Dots */}
      <View className="mb-2 flex-row items-center justify-center" style={{gap: 8}}>
        {SLIDES.map((s, i) => (
          <View
            key={s.titleKey}
            className={`h-2 rounded-full ${
              i === index ? 'w-6 bg-primary' : 'w-2 bg-border'
            }`}
          />
        ))}
      </View>

      <View className="px-6 pb-6 pt-2">
        <Button
          title={isLast ? t('onboarding.getStarted') : t('onboarding.next')}
          onPress={onNext}
        />
      </View>
    </SafeAreaView>
  );
}
