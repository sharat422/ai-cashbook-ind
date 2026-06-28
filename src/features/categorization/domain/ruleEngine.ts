import type {AiCategory, CategorizationResult} from './entities';

/**
 * Keyword rules per category. Order doesn't matter — the engine scores every
 * category and picks the strongest match. Keep terms lowercase.
 */
const KEYWORDS: Record<Exclude<AiCategory, 'Miscellaneous'>, string[]> = {
  Rent: ['rent', 'lease', 'landlord', 'tenant'],
  Salary: ['salary', 'payroll', 'wages', 'stipend', 'staff pay'],
  Food: [
    'restaurant',
    'cafe',
    'food',
    'swiggy',
    'zomato',
    'grocery',
    'bakery',
    'dining',
    'meal',
    'snacks',
    'kitchen',
  ],
  Travel: [
    'flight',
    'airlines',
    'train',
    'irctc',
    'uber',
    'ola',
    'taxi',
    'cab',
    'bus',
    'travel',
    'ticket',
    'hotel',
  ],
  Fuel: [
    'fuel',
    'petrol',
    'diesel',
    'indian oil',
    'iocl',
    'bharat petroleum',
    'bpcl',
    'hpcl',
    'hp petrol',
  ],
  Inventory: [
    'inventory',
    'stock',
    'wholesale',
    'supplies',
    'raw material',
    'goods',
    'purchase order',
    'sku',
  ],
  Utilities: [
    'electricity',
    'water bill',
    'gas bill',
    'internet',
    'broadband',
    'recharge',
    'utility',
    'bsnl',
    'airtel',
    'jio',
    'bses',
    'power bill',
  ],
  Marketing: [
    'marketing',
    'ads',
    'advertis',
    'google ads',
    'facebook ads',
    'promotion',
    'campaign',
    'seo',
    'branding',
    'flyer',
  ],
};

/**
 * Fallback categorizer: pure, offline, keyword-based. Used when the GPT backend
 * is unavailable (offline, error, or timeout). Confidence reflects how many
 * keywords matched, capped well below a confident AI result so the UI can tell
 * the two apart.
 */
export function categorizeByRules(text: string): CategorizationResult {
  const haystack = text.toLowerCase();

  let bestCategory: AiCategory = 'Miscellaneous';
  let bestHits = 0;

  (Object.keys(KEYWORDS) as Array<keyof typeof KEYWORDS>).forEach(category => {
    const hits = KEYWORDS[category].reduce(
      (count, kw) => (haystack.includes(kw) ? count + 1 : count),
      0,
    );
    if (hits > bestHits) {
      bestHits = hits;
      bestCategory = category;
    }
  });

  // No keyword matched → unknown, low confidence.
  if (bestHits === 0) {
    return {category: 'Miscellaneous', confidence: 0.2, source: 'rule'};
  }

  // 1 hit → 0.55, 2 → 0.65, capped at 0.8 (never as sure as the model).
  const confidence = Math.min(0.45 + bestHits * 0.1, 0.8);
  return {category: bestCategory, confidence, source: 'rule'};
}
