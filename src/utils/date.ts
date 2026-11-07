/**
 * Date helpers. Business dates are Indian Standard Time everywhere — a sale
 * at 00:30 IST belongs to that day even if the phone is set to another zone
 * or the server stamped it in UTC. IST is UTC+05:30 all year (no DST), so a
 * fixed offset is exact and needs no time-zone database.
 */
import {translate, type TKey} from '@/i18n';
import {useAuthStore} from '@store/auth.store';

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Convert a Date to an ISO date string (YYYY-MM-DD), local time — for picker values. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(instant: Date = new Date()): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's date in India. */
export const todayIST = (): string => istDate();

/** "14 Jun 2026" — month name in the app language; numbers stay 0-9. */
export function formatDisplayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return iso;
  const lang = useAuthStore.getState().preferredLanguage;
  return `${m[3]} ${translate(lang, `date.mon.${month}` as TKey)} ${m[1]}`;
}

/** A server timestamp (e.g. "2026-11-07T19:00:00Z") shown as its IST date. */
export function formatTimestampDate(timestamp: string): string {
  const t = Date.parse(timestamp);
  return Number.isNaN(t) ? formatDisplayDate(timestamp) : formatDisplayDate(istDate(new Date(t)));
}

/** "14 Jun 2026, 09:05" in IST (24-hour, so no am/pm words to translate). */
export function formatTimestamp(timestamp: string): string {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return timestamp;
  const ist = new Date(t + IST_OFFSET_MS).toISOString();
  return `${formatDisplayDate(ist.slice(0, 10))}, ${ist.slice(11, 16)}`;
}
