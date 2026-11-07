export type AppLanguage =
  | 'te'
  | 'hinglish'
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

/** Telugu first: a new install opens in Telugu (switchable on the login screen). */
export const DEFAULT_APP_LANGUAGE: AppLanguage = 'te';

/** Picker order: the three main choices first, then the other languages. */
export const PRIMARY_APP_LANGUAGES: ReadonlyArray<AppLanguage> = ['te', 'hinglish', 'en'];

export const SUPPORTED_APP_LANGUAGES: ReadonlyArray<AppLanguage> = [
  'te',
  'hinglish',
  'en',
  'hi',
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
  te: 'తెలుగు',
  hinglish: 'Hinglish',
  en: 'English',
  hi: 'हिन्दी',
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
