import React from 'react';
import {View} from 'react-native';

import {Button} from './Button';
import {Text} from './Text';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Reusable error block with a retry action. */
export function ErrorState({
  title = "Couldn't load data",
  message = 'Check your connection and try again.',
  onRetry,
  retrying,
}: ErrorStateProps): React.JSX.Element {
  return (
    <View className="items-center rounded-2xl border border-border bg-white px-6 py-10">
      <Text className="text-4xl">⚠️</Text>
      <Text variant="label" className="mt-3 text-center text-base">
        {title}
      </Text>
      <Text variant="caption" className="mt-1 text-center">
        {message}
      </Text>
      {onRetry ? (
        <View className="mt-5 w-full">
          <Button
            title="Try again"
            variant="secondary"
            loading={retrying}
            onPress={onRetry}
          />
        </View>
      ) : null}
    </View>
  );
}
