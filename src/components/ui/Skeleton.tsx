import React, {useEffect, useRef} from 'react';
import {Animated, View, ViewStyle} from 'react-native';

export interface SkeletonProps {
  className?: string;
  style?: ViewStyle;
}

/**
 * Lightweight loading placeholder. Pulses opacity via a single Animated.Value
 * on the **native driver** (runs on the UI thread, off the JS thread) so it
 * stays smooth on low-end Android without per-frame JS work or reanimated.
 */
function SkeletonBase({className, style}: SkeletonProps): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      // bg-slate-200 placeholder; rounding/size come from className.
      className={`rounded-lg bg-slate-200 ${className ?? ''}`}
      style={[{opacity}, style]}
    />
  );
}

/** Memoized so a grid of skeletons doesn't re-render with the parent. */
export const Skeleton = React.memo(SkeletonBase);

/** Decorative, non-interactive container; hidden from screen readers. */
export function SkeletonGroup({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </View>
  );
}
