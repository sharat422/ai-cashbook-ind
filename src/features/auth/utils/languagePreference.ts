export type AppLanguage =
  | 'en'
  | 'hi'
  | 'te'
  | 'ta'
  | 'kn'
  | 'mr'
  | 'gu'
  | 'bn'
  | 'ml'
  | 'pa';

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'en';

export const SUPPORTED_APP_LANGUAGES: ReadonlyArray<AppLanguage> = [
  'en',
  'hi',
  'te',
  'ta',
  'kn',
  'mr',
  'gu',
  'bn',
  'ml',
  'pa',
];

/** Shown in the language picker — each language in its own script. */
export const APP_LANGUAGE_LABEL: Record<AppLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  te: 'తెలుగు',
  ta: 'தமிழ்',
  kn: 'ಕನ್ನಡ',
  mr: 'मराठी',
  gu: 'ગુજરાતી',
  bn: 'বাংলা',
  ml: 'മലയാളം',
  pa: 'ਪੰਜਾਬੀ',
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

/** Reverse of APP_LANGUAGE_LABEL — resolve a picked label back to its code. */
export function appLanguageByLabel(label: string): AppLanguage {
  const match = SUPPORTED_APP_LANGUAGES.find(
    l => APP_LANGUAGE_LABEL[l] === label,
  );
  return match ?? DEFAULT_APP_LANGUAGE;
}
