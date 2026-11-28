import type {TranslateFn} from '@/i18n';

/** A van by its name (Settings → Vans); one not named yet by its driver's name.
 *  Never a phone number: the Stock screen and the bills show it. */
export function vanLabel(t: TranslateFn, v?: {name: string | null; staffName: string | null} | null): string {
  return `🚚 ${v?.name || (v?.staffName ? t('vans.ofPerson', {name: v.staffName}) : t('vans.unnamed'))}`;
}
