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

function labelOr(t: TranslateFn, key: string, fallback: string): string {
  const text = t(key as TKey);
  return text === key ? fallback : text;
}
