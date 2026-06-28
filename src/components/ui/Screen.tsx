import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import {Edge, SafeAreaView} from 'react-native-safe-area-context';

export interface ScreenProps {
  children: React.ReactNode;
  /** Wrap content in a ScrollView (default true). Disable for fixed layouts. */
  scroll?: boolean;
  /** Extra classes on the inner content container. */
  className?: string;
  edges?: readonly Edge[];
}

/**
 * Page wrapper: applies safe-area insets, the app background, keyboard
 * avoidance and optional scrolling so screens stay focused on content.
 */
export function Screen({
  children,
  scroll = true,
  className,
  edges = ['top', 'bottom'],
}: ScreenProps): React.JSX.Element {
  const content = (
    <View className={`flex-1 px-5 ${className ?? ''}`}>{children}</View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={edges}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{flexGrow: 1}}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
