import type {TranslateFn, TKey} from './index';

/**
 * Display names for values the app stores in English (payment methods,
 * income/expense categories). The stored value never changes — only what the
 * user reads. Unknown values (e.g. a category from an older build) show as-is.
 */
export function paymentMethodLabel(t: TranslateFn, method: string): string {
  return labelOr(t, `pay.${method}`, method);
}

export function categoryLabel(t: TranslateFn, category: string): string {
  return labelOr(t, `cat.${category}`, category);
}

const BUSINESS_TYPE_KEY: Record<string, string> = {
  Distributor: 'distributor', Agency: 'agency', FMCG: 'fmcg', Wholesale: 'wholesale', Retail: 'retail',
  Manufacturing: 'manufacturing', Services: 'services', 'Restaurant / Food': 'restaurant',
  'E-commerce': 'ecommerce', Other: 'other',
};

/** A business type (stored in English) in the user's language; anything else as typed. */
export function businessTypeLabel(t: TranslateFn, type: string): string {
  const key = BUSINESS_TYPE_KEY[type];
  return key ? labelOr(t, `businessType.${key}`, type) : type;
}

function labelOr(t: TranslateFn, key: string, fallback: string): string {
  const text = t(key as TKey);
  return text === key ? fallback : text;
}
