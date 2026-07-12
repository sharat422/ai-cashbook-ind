export type AppLanguage = 'en' | 'hi' | 'kn' | 'ta' | 'te';

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'en';

export const SUPPORTED_APP_LANGUAGES: ReadonlyArray<AppLanguage> = [
  'en',
  'hi',
  'kn',
  'ta',
  'te',
];

export const APP_LANGUAGE_LABEL: Record<AppLanguage, string> = {
  en: 'English',
  hi: 'Hindi',
  kn: 'Kannada',
  ta: 'Tamil',
  te: 'Telugu',
};

export function normalizePreferredLanguage(value?: string | null): AppLanguage {
  if (!value) return DEFAULT_APP_LANGUAGE;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_APP_LANGUAGES.includes(normalized as AppLanguage)
    ? (normalized as AppLanguage)
    : DEFAULT_APP_LANGUAGE;
}

export function getLanguageLabel(language: AppLanguage): string {
  return APP_LANGUAGE_LABEL[language] ?? APP_LANGUAGE_LABEL[DEFAULT_APP_LANGUAGE];
}
