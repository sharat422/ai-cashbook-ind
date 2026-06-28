import React from 'react';
import {View} from 'react-native';

import {Text} from './Text';

/** Premium, slightly-desaturated palette for initials avatars. */
const PALETTE = [
  '#6366F1', // indigo
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
];

/** Up to two initials from a name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable colour from the name so a customer always gets the same avatar. */
function colorOf(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export interface AvatarProps {
  name: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/** Circular initials avatar with a deterministic colour. Reusable app-wide. */
function AvatarBase({
  name,
  size = 48,
  className,
}: AvatarProps): React.JSX.Element {
  return (
    <View
      className={`items-center justify-center rounded-full ${className ?? ''}`}
      style={{width: size, height: size, backgroundColor: colorOf(name)}}>
      <Text
        className="font-bold text-white"
        style={{fontSize: size * 0.4}}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

export const Avatar = React.memo(AvatarBase);
