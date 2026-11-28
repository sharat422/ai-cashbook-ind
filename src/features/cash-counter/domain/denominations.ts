/** Indian notes and coins in circulation, highest first. No ₹2000: the RBI withdrew it from
 *  circulation in 2023 (it can only be exchanged at the RBI), so a shop's drawer shouldn't hold it. */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

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

/** What was counted, for the saved count's note: "₹500×10, ₹100×8". */
export function countNote(counts: Counts): string {
  return DENOMINATIONS.filter(d => counts[d]).map(d => `₹${d}×${counts[d]}`).join(', ');
}

/** Subtotal for one denomination. */
export function subtotal(denom: number, count: number): number {
  return denom * (count || 0);
}
