/** Indian currency denominations (notes + coins), highest first. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export type Denomination = (typeof DENOMINATIONS)[number];

export type Counts = Record<number, number>;

/** Total cash value from a per-denomination count map. */
export function cashTotal(counts: Counts): number {
  return DENOMINATIONS.reduce((sum, d) => sum + d * (counts[d] || 0), 0);
}

/** Total number of notes/coins counted. */
export function totalPieces(counts: Counts): number {
  return DENOMINATIONS.reduce((n, d) => n + (counts[d] || 0), 0);
}

/** Subtotal for one denomination. */
export function subtotal(denom: number, count: number): number {
  return denom * (count || 0);
}
