/**
 * Design tokens shared between NativeWind (tailwind.config.js) and imperative
 * styles (e.g. StatusBar, ActivityIndicator) that can't consume className.
 */
export const colors = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryLight: '#60A5FA',
  surface: '#FFFFFF',
  background: '#F8FAFC',
  muted: '#64748B',
  border: '#E2E8F0',
  danger: '#DC2626',
  success: '#16A34A',
  text: '#0F172A',
} as const;

export type ColorToken = keyof typeof colors;
