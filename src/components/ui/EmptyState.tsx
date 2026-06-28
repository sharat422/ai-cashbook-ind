import React from 'react';
import {View} from 'react-native';

import {Button} from './Button';
import {Text} from './Text';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Reusable empty-state block: icon, message, and an optional CTA. */
export function EmptyState({
  icon = '📭',
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View className="items-center rounded-2xl border border-border bg-white px-6 py-10">
      <Text className="text-4xl">{icon}</Text>
      <Text variant="label" className="mt-3 text-center text-base">
        {title}
      </Text>
      {message ? (
        <Text variant="caption" className="mt-1 text-center">
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View className="mt-5 w-full">
          <Button title={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
