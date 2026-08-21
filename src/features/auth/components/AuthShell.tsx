import React from 'react';
import {View} from 'react-native';

import {Screen, Text} from '@components/ui';

/** Soft elevation for the auth card (RN needs style props for shadows). */
const CARD_SHADOW = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 24,
  shadowOffset: {width: 0, height: 10},
  elevation: 4,
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
      <View className="flex-1 justify-center py-8">
        {/* Wordmark */}
        <View className="mb-9 flex-row items-center justify-center">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary">
            <Text className="text-xl font-black text-white">₹</Text>
          </View>
          <Text className="ml-2.5 text-xl font-extrabold tracking-tight text-slate-900">
            Smart CashBook
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
          className="mt-8 rounded-3xl border border-border/60 bg-white p-6"
          style={CARD_SHADOW}>
          {children}
        </View>

        {footer ? <View className="mt-6">{footer}</View> : null}
      </View>
    </Screen>
  );
}
