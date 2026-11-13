import type {CollectionTone, Language} from './entities';
import reviewedHinglish from '@/i18n/reviewed/hinglish.json';
import {translations} from '@/i18n/translations';
import {logError} from '@/services/diagnostics/errorLog.store';

/**
 * Collection messages by language × tone: `collect.tpl.<tone>` in the locale
 * files (placeholders {name}, {amount} already INR-formatted, {days}). They're
 * on review sheet 7, "Messages retailers receive".
 *
 * Hinglish goes out only once a reviewer has passed it (TE6):
 * `src/i18n/reviewed/hinglish.json`, written by `scripts/i18n_review_sheets.py
 * apply`, each line pinned to the English it was reviewed against. Until a tone
 * is reviewed (or if its English changed since), the message goes out in
 * English, logged once in Diagnostics. Nothing is translated at send time.
 */
type Reviewed = Record<string, {en: string; text: string}>;
export const REVIEWED: Partial<Record<Language, Reviewed>> = {hinglish: reviewedHinglish as Reviewed};
const logged = new Set<string>();

export function templateFor(language: Language, tone: CollectionTone): string {
  const key = `collect.tpl.${tone}` as const;
  const english = translations.en[key] ?? '';
  if (language !== 'hinglish') return translations[language][key] ?? english;
  const hit = REVIEWED.hinglish?.[key];
  if (hit && hit.en === english) return hit.text;
  if (!logged.has(key)) {
    logged.add(key);
    logError('i18n', new Error(`No reviewed hinglish collection message for ${key}`
      + `${hit ? ' (the English changed since review)' : ''}; using English`));
  }
  return english;
}
