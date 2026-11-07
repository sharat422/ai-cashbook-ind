import type {Scheme} from '@features/schemes/data/schemes.remote';

const n = (s: string | null | undefined): string =>
  s == null ? '' : s.includes('.') ? s.replace(/\.?0+$/, '') : s;

/** One line describing the offer, e.g. "Buy 10, get 1 free". */
export function describeScheme(s: Scheme, itemName: (id: string) => string): string {
  switch (s.type) {
    case 'buy_get':
      return `Buy ${n(s.buyQty)}, get ${n(s.freeQty)} free`;
    case 'free_goods':
      return `Every ${n(s.minQty)} bought: ${n(s.freeQty)} ${itemName(s.freeItemId ?? '')} free`;
    case 'percent':
      return `${n(s.percent)}% off${s.minQty && Number(s.minQty) > 0 ? ` from ${n(s.minQty)} units` : ''}`;
    case 'slab':
      return (s.slabs ?? []).map(([q, p]) => `${n(q)}+ → ${n(p)}% off`).join(', ');
  }
}

/** Active, and today inside its dates (inclusive). */
export function schemeStatus(s: Scheme, today: string): 'live' | 'expired' | 'upcoming' | 'off' {
  if (!s.active) return 'off';
  if (today > s.validTo) return 'expired';
  if (today < s.validFrom) return 'upcoming';
  return 'live';
}
