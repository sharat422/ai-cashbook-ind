import type {Scheme} from '@features/schemes/data/schemes.remote';
import type {TranslateFn} from '@/i18n';

const n = (s: string | null | undefined): string =>
  s == null ? '' : s.includes('.') ? s.replace(/\.?0+$/, '') : s;

/** One line describing the offer, e.g. "Buy 10, get 1 free", in the user's language. */
export function describeScheme(t: TranslateFn, s: Scheme, itemName: (id: string) => string): string {
  switch (s.type) {
    case 'buy_get':
      return t('schemes.desc.buyGet', {buy: n(s.buyQty), free: n(s.freeQty)});
    case 'free_goods':
      return t('schemes.desc.freeGoods', {min: n(s.minQty), free: n(s.freeQty), item: itemName(s.freeItemId ?? '')});
    case 'percent':
      if (s.level === 'bill') return t('schemes.desc.percentBill', {percent: n(s.percent), min: n(s.minBillValue ?? '0')});
      return s.minQty && Number(s.minQty) > 0
        ? t('schemes.desc.percentFrom', {percent: n(s.percent), min: n(s.minQty)})
        : t('schemes.desc.percent', {percent: n(s.percent)});
    case 'amount_off':
      return t('schemes.desc.amountOff', {amount: n(s.amountOff), min: n(s.minBillValue ?? '0')});
    case 'slab':
      return (s.slabs ?? []).map(([q, p]) => t('schemes.desc.slab', {qty: n(q), percent: n(p)})).join(', ');
  }
}

/** Active, and today inside its dates (inclusive). */
export function schemeStatus(s: Scheme, today: string): 'live' | 'expired' | 'upcoming' | 'off' {
  if (!s.active) return 'off';
  if (today > s.validTo) return 'expired';
  if (today < s.validFrom) return 'upcoming';
  return 'live';
}
