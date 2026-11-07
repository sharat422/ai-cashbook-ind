import React from 'react';
import {View} from 'react-native';

import {Button} from './Button';
import {Text} from './Text';
import {useT} from '@/i18n';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Reusable error block with a retry action. */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying,
}: ErrorStateProps): React.JSX.Element {
  const t = useT();
  return (
    <View className="items-center rounded-2xl border border-border bg-white px-6 py-10">
      <Text className="text-4xl">⚠️</Text>
      <Text variant="label" className="mt-3 text-center text-base">
        {title ?? t('errors.loadTitle')}
      </Text>
      <Text variant="caption" className="mt-1 text-center">
        {message ?? t('errors.loadMsg')}
      </Text>
      {onRetry ? (
        <View className="mt-5 w-full">
          <Button
            title={t('common.retry')}
            variant="secondary"
            loading={retrying}
            onPress={onRetry}
          />
        </View>
      ) : null}
    </View>
  );
}
