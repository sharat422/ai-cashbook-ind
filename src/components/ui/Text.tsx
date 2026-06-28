import React from 'react';
import {Text as RNText, TextProps as RNTextProps} from 'react-native';

type Variant = 'title' | 'subtitle' | 'body' | 'caption' | 'label';

const VARIANT_CLASS: Record<Variant, string> = {
  title: 'text-2xl font-bold text-slate-900',
  subtitle: 'text-base text-muted',
  body: 'text-base text-slate-900',
  caption: 'text-xs text-muted',
  label: 'text-sm font-semibold text-slate-700',
};

export interface TextProps extends RNTextProps {
  variant?: Variant;
  className?: string;
}

/** Typographic primitive so screens never hard-code font sizes inline. */
export function Text({
  variant = 'body',
  className,
  ...props
}: TextProps): React.JSX.Element {
  return (
    <RNText
      className={`${VARIANT_CLASS[variant]} ${className ?? ''}`}
      {...props}
    />
  );
}
