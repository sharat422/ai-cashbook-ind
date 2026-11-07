import {useCallback} from 'react';

import type {AppLanguage} from '@features/auth/utils/languagePreference';
import {useAuthStore} from '@store/auth.store';
import {en, translations, type TKey} from './translations';

export type TranslateFn = (
  key: TKey,
  vars?: Record<string, string | number>,
) => string;

/** Pure translation lookup: selected language → English fallback → key. */
export function translate(
  lang: AppLanguage,
  key: TKey,
  vars?: Record<string, string | number>,
): string {
  let str: string = translations[lang]?.[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

/**
 * Translate with the language selected right now, outside React (validation,
 * API errors, share helpers). Screens should prefer `useT()`, which also
 * re-renders on a language change.
 */
export function tNow(key: TKey, vars?: Record<string, string | number>): string {
  return translate(useAuthStore.getState().preferredLanguage, key, vars);
}

/**
 * Returns a `t(key, vars?)` translator bound to the user's selected content
 * language. Falls back to English for any missing key, and interpolates
 * `{name}` placeholders from `vars`. Re-renders the caller when the language
 * changes (the preference lives in the auth store).
 */
export function useT(): TranslateFn {
  const lang = useAuthStore(s => s.preferredLanguage);
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}
