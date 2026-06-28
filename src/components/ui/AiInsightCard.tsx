import React from 'react';
import {View} from 'react-native';

import {Text} from './Text';

export interface AiInsightCardProps {
  /** Leading emoji/icon. */
  icon?: string;
  title: string;
  /** Optional right-aligned chip node (e.g. a badge). */
  badge?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Reusable "AI insight" card — a soft, premium container with an icon + title
 * header (and optional badge). Use it for any model-driven insight so they all
 * look consistent across the app.
 */
export function AiInsightCard({
  icon = '✨',
  title,
  badge,
  subtitle,
  children,
}: AiInsightCardProps): React.JSX.Element {
  return (
    <View
      className="rounded-2xl border border-border bg-white p-4"
      style={{
        shadowColor: '#0F172A',
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: {width: 0, height: 4},
        elevation: 2,
      }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center" style={{gap: 8}}>
          <View className="h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Text className="text-base">{icon}</Text>
          </View>
          <View>
            <Text className="text-base font-bold text-slate-900">{title}</Text>
            {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
          </View>
        </View>
        {badge}
      </View>
      <View className="mt-4">{children}</View>
    </View>
  );
}
