/** Quantities as the server sends them: exact strings with 3 decimals.
 *  Arithmetic is done in whole thousandths, never floats. */

const QTY_RE = /^\d+(\.\d{1,3})?$/;

/** A typed quantity is usable: digits, up to 3 decimals (zero allowed for counts). */
export const isQty = (s: string, allowZero = false): boolean =>
  QTY_RE.test(s.trim()) && (allowZero || toMilli(s) > 0);

export function toMilli(s: string): number {
  const neg = s.trim().startsWith('-');
  const [whole, frac = ''] = s.trim().replace('-', '').split('.');
  const m = Number(whole) * 1000 + Number(frac.padEnd(3, '0').slice(0, 3));
  return neg ? -m : m;
}

/** "12.500" → "12.5", "-3.000" → "−3". */
export function formatQty(s: string, unit?: string | null): string {
  const m = toMilli(s);
  const abs = Math.abs(m);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  const text = `${m < 0 ? '−' : ''}${Math.floor(abs / 1000).toLocaleString('en-IN')}${frac ? `.${frac}` : ''}`;
  return unit ? `${text} ${unit}` : text;
}

/** Counted − system, as a server-style string (preview before saving). */
export function difference(counted: string, system: string): string {
  const d = toMilli(counted) - toMilli(system);
  const abs = Math.abs(d);
  return `${d < 0 ? '-' : ''}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}
