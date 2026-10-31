/**
 * Design tokens shared between NativeWind (tailwind.config.js) and imperative
 * styles (e.g. StatusBar, ActivityIndicator) that can't consume className.
 */
export const colors = {
  primary: '#4F46E5',
  primaryDark: '#4338CA',
  primaryLight: '#818CF8',
  surface: '#FFFFFF',
  background: '#F5F6FF',
  muted: '#64748B',
  border: '#E2E8F0',
  danger: '#DC2626',
  success: '#16A34A',
  text: '#0F172A',
} as const;

export type ColorToken = keyof typeof colors;
