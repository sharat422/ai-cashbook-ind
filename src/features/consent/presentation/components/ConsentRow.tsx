import React from 'react';
import {Switch, View} from 'react-native';

import {Text} from '@components/ui';

/**
 * One consent purpose: a title, a plain-language explanation, and a toggle.
 * Required purposes render locked-on (the switch is disabled) with a "Required"
 * badge, so the user sees they can't proceed without them but nothing is hidden.
 */
export function ConsentRow({
  title,
  description,
  value,
  onValueChange,
  required = false,
  requiredLabel,
  lastUpdatedLabel,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange?: (next: boolean) => void;
  required?: boolean;
  requiredLabel?: string;
  lastUpdatedLabel?: string | null;
}): React.JSX.Element {
  return (
    <View className="rounded-2xl border border-border bg-white px-4 py-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center" style={{gap: 8}}>
            <Text className="text-base font-semibold text-slate-900">
              {title}
            </Text>
            {required && requiredLabel ? (
              <View className="rounded-full bg-slate-100 px-2 py-0.5">
                <Text className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {requiredLabel}
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-1 text-sm leading-5 text-muted">
            {description}
          </Text>
          {lastUpdatedLabel ? (
            <Text className="mt-2 text-xs text-slate-400">
              {lastUpdatedLabel}
            </Text>
          ) : null}
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={required || !onValueChange}
        />
      </View>
    </View>
  );
}
