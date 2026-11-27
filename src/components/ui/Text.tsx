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

const ALIGN = /^text-(left|center|right|justify|start|end)$/;
const SIZE = /^text-(xs|sm|base|lg|\d?xl|\[[\d.]+(px|rem)\])$/;
const WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const kind = (c: string) =>
  SIZE.test(c) ? 'size' : WEIGHT.test(c) ? 'weight' : c.startsWith('text-') && !ALIGN.test(c) ? 'colour' : null;

/**
 * The variant's classes, minus any size, weight or colour the screen sets itself. NativeWind settles
 * clashing classes by their order in the generated CSS, not in className, so without this the
 * variant's text-slate-900 beat text-slate-400 / text-green-300 (black on the dark cards) and its
 * text-base beat text-4xl.
 */
export function textClass(variant: Variant, className = ''): string {
  const own = new Set(className.split(/\s+/).map(kind));
  return `${VARIANT_CLASS[variant].split(' ').filter(c => !own.has(kind(c))).join(' ')} ${className}`.trim();
}

/** Typographic primitive so screens never hard-code font sizes inline. */
export function Text({
  variant = 'body',
  className,
  ...props
}: TextProps): React.JSX.Element {
  return <RNText className={textClass(variant, className)} {...props} />;
}
