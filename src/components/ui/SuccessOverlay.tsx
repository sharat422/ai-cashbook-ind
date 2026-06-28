import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Modal, View} from 'react-native';

import {Confetti} from './Confetti';
import {Text} from './Text';

export interface SuccessOverlayProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Called after the confirmation animation + hold (default ~1.5s). */
  onDone: () => void;
  holdMs?: number;
  /** Rain confetti behind the check badge (e.g. payment received). */
  confetti?: boolean;
}

/**
 * Full-screen animated success confirmation: a check badge springs in, the text
 * fades up, it holds briefly, then calls `onDone`. Driven on the native driver
 * so it stays smooth. Reusable for any "saved!" moment.
 */
export function SuccessOverlay({
  visible,
  title,
  subtitle,
  onDone,
  holdMs = 1500,
  confetti = false,
}: SuccessOverlayProps): React.JSX.Element {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0);
      opacity.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(onDone, holdMs);
    return () => clearTimeout(timer);
  }, [visible, holdMs, onDone, scale, opacity]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-slate-900/95 px-10">
        {confetti ? <Confetti active={visible} /> : null}
        <Animated.View style={{transform: [{scale}]}}>
          <View className="h-24 w-24 items-center justify-center rounded-full bg-success">
            <Text className="text-5xl text-white">✓</Text>
          </View>
        </Animated.View>
        <Animated.View style={{opacity}} className="mt-6 items-center">
          <Text className="text-center text-2xl font-bold text-white">
            {title}
          </Text>
          {subtitle ? (
            <Text className="mt-1 text-center text-sm text-slate-300">
              {subtitle}
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}
