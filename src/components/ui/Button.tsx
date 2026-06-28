import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  Text,
} from 'react-native';

import {colors} from '@theme/colors';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
}

const CONTAINER: Record<Variant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-white border border-border',
  ghost: 'bg-transparent',
};

const LABEL: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-slate-900',
  ghost: 'text-primary',
};

/** App-wide pressable button with loading + disabled states. */
export function Button({
  title,
  variant = 'primary',
  loading = false,
  fullWidth = true,
  disabled,
  className,
  ...props
}: ButtonProps): React.JSX.Element {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!isDisabled, busy: loading}}
      disabled={isDisabled}
      className={`h-14 flex-row items-center justify-center rounded-xl px-5 ${
        CONTAINER[variant]
      } ${fullWidth ? 'w-full' : ''} ${isDisabled ? 'opacity-50' : ''} ${
        className ?? ''
      }`}
      {...props}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? '#FFFFFF' : colors.primary}
        />
      ) : (
        <Text className={`text-base font-semibold ${LABEL[variant]}`}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
