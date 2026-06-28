import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Dimensions, Easing, View} from 'react-native';

const COLORS = [
  '#6366F1',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#FACC15',
];

interface Piece {
  left: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  drift: number;
  rotations: number;
}

export interface ConfettiProps {
  /** Start the burst when true. */
  active: boolean;
  count?: number;
}

/**
 * Lightweight confetti burst — pure Animated on the native driver (no native
 * dependency). Each piece falls, drifts, spins, and fades. Decorative only.
 */
function ConfettiBase({active, count = 80}: ConfettiProps): React.JSX.Element {
  const {width, height} = Dimensions.get('window');
  const progress = useRef(new Animated.Value(0)).current;

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({length: count}).map(() => ({
        left: Math.random() * width,
        size: 6 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay: Math.random() * 400,
        duration: 1600 + Math.random() * 1400,
        drift: (Math.random() - 0.5) * 160,
        rotations: 2 + Math.random() * 4,
      })),
    [count, width],
  );

  useEffect(() => {
    if (!active) {
      progress.setValue(0);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 2600,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [active, progress]);

  if (!active) return <View />;

  return (
    <View pointerEvents="none" className="absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => {
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-40, height + 40],
        });
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, p.drift],
        });
        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${p.rotations * 360}deg`],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 0.85, 1],
          outputRange: [1, 1, 0],
        });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: p.left,
              top: 0,
              width: p.size,
              height: p.size * 0.6,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity,
              transform: [{translateY}, {translateX}, {rotate}],
            }}
          />
        );
      })}
    </View>
  );
}

export const Confetti = React.memo(ConfettiBase);
