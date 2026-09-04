import type {AppLanguage} from '@features/auth/utils/languagePreference';

import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';
import ta from './locales/ta.json';
import kn from './locales/kn.json';
import mr from './locales/mr.json';
import gu from './locales/gu.json';
import bn from './locales/bn.json';
import ml from './locales/ml.json';
import pa from './locales/pa.json';

/**
 * App UI strings.
 *
 * `en` (src/i18n/locales/en.json) is the source of truth and the fallback for
 * any key a translation is missing. The other locales are **generated** from it
 * by `scripts/i18n-translate.mjs` (Anthropic Batch API, incremental — only
 * changed/new keys are re-translated). Do not hand-edit the non-English files;
 * add or change a string in en.json, then run `npm run i18n:translate`.
 *
 * `{count}` / `{n}` / `{name}` placeholders are filled by `useT` and are kept
 * verbatim by the translator.
 */
export type TKey = keyof typeof en;

export const translations: Record<AppLanguage, Partial<Record<TKey, string>>> = {
  en,
  hi,
  te,
  ta,
  kn,
  mr,
  gu,
  bn,
  ml,
  pa,
};

export {en};
