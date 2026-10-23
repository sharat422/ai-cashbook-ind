import React from 'react';
import {View} from 'react-native';

import {Screen, Text} from '@components/ui';

/** Soft elevation for the auth card (RN needs style props for shadows). */
const CARD_SHADOW = {
  shadowColor: '#4F46E5',
  shadowOpacity: 0.12,
  shadowRadius: 24,
  shadowOffset: {width: 0, height: 10},
  elevation: 4,
} as const;

/** Coloured glow under the logo tile. */
const LOGO_SHADOW = {
  shadowColor: '#4F46E5',
  shadowOpacity: 0.35,
  shadowRadius: 14,
  shadowOffset: {width: 0, height: 6},
  elevation: 6,
} as const;

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Rendered below the card (e.g. legal microcopy or a secondary action). */
  footer?: React.ReactNode;
}

/**
 * Shared visual shell for the authentication / onboarding flow: a centered
 * wordmark, a bold hero heading + supportive subtitle, and a clean white card
 * that holds the form — a calm, premium first impression.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: AuthShellProps): React.JSX.Element {
  return (
    <Screen>
      {/* Soft brand glow behind the header (plain Views — no gradient lib) */}
      <View
        pointerEvents="none"
        className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary-light opacity-20"
      />
      <View
        pointerEvents="none"
        className="absolute -left-28 top-40 h-56 w-56 rounded-full bg-primary opacity-10"
      />
      <View className="flex-1 justify-center py-8">
        {/* Wordmark */}
        <View className="mb-9 flex-row items-center justify-center">
          <View
            className="h-12 w-12 items-center justify-center rounded-2xl bg-primary"
            style={LOGO_SHADOW}>
            <Text className="text-2xl font-black text-white">₹</Text>
          </View>
          <Text className="ml-3 text-2xl font-black tracking-tight text-primary-dark">
            Bolcash
          </Text>
        </View>

        {/* Hero */}
        <Text className="text-center text-3xl font-extrabold tracking-tight text-slate-900">
          {title}
        </Text>
        {subtitle ? (
          <Text className="mx-auto mt-3 max-w-[20rem] text-center text-base leading-6 text-muted">
            {subtitle}
          </Text>
        ) : null}

        {/* Card */}
        <View
          className="mt-8 rounded-3xl border border-primary/10 bg-white p-6"
          style={CARD_SHADOW}>
          {children}
        </View>

        {footer ? <View className="mt-6">{footer}</View> : null}
      </View>
    </Screen>
  );
}
