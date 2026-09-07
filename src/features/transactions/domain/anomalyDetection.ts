/**
 * Lightweight, on-device anomaly detection for money entries.
 *
 * Pure and synchronous so it can run the instant the user hits Save. It NEVER
 * blocks or changes an entry — callers surface the returned flags as a gentle
 * "double-check this" prompt and the user decides whether to save anyway.
 *
 * Two heuristics, deliberately conservative to avoid nagging:
 *  1. duplicate      — same amount + same day + a similar description as an
 *                      existing entry (a likely accidental re-entry).
 *  2. round-outlier  — a round amount (e.g. ₹2,000) when the business's usual
 *                      entries are NOT round, so it stands out as a probable
 *                      estimate/typo. Skipped for round-number businesses and
 *                      when there isn't enough history to judge.
 */

export interface AnomalyCandidate {
  amount: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  category?: string | null;
  /** Free text identifying the entry: vendor, party name, or notes. */
  description?: string | null;
}

export type AnomalyType = 'duplicate' | 'round-outlier';
export interface Anomaly {
  type: AnomalyType;
}

// --- tuning knobs (kept explicit so the behaviour is easy to reason about) ----
/** Need at least this many past entries before judging what's "typical". */
export const MIN_HISTORY_FOR_PATTERN = 5;
/** "Round" = a whole multiple of ₹500… */
const ROUND_STEP = 500;
/** …of at least this much (ignore tiny amounts like ₹0/₹500 noise below it). */
const ROUND_MIN = 500;
/** Only flag a round amount if fewer than this share of past entries are round. */
const MAX_ROUND_SHARE = 0.4;

function norm(s?: string | null): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isRoundAmount(amount: number): boolean {
  return amount >= ROUND_MIN && amount % ROUND_STEP === 0;
}

/** Descriptions "match" if equal/containing; if one is blank, fall back to the
 * category so two same-amount-same-day entries in the same bucket still pair. */
function similarDescription(a: AnomalyCandidate, b: AnomalyCandidate): boolean {
  const da = norm(a.description);
  const db = norm(b.description);
  if (da && db) return da === db || da.includes(db) || db.includes(da);
  const ca = norm(a.category);
  return ca !== '' && ca === norm(b.category);
}

function isDuplicate(
  candidate: AnomalyCandidate,
  recent: AnomalyCandidate[],
): boolean {
  return recent.some(
    e =>
      e.amount === candidate.amount &&
      e.date === candidate.date &&
      similarDescription(candidate, e),
  );
}

function isRoundOutlier(
  candidate: AnomalyCandidate,
  recent: AnomalyCandidate[],
): boolean {
  if (!isRoundAmount(candidate.amount)) return false;
  if (recent.length < MIN_HISTORY_FOR_PATTERN) return false;
  const roundShare =
    recent.filter(e => isRoundAmount(e.amount)).length / recent.length;
  return roundShare < MAX_ROUND_SHARE;
}

/**
 * Return the anomaly flags for a candidate entry given recent entries of the
 * SAME kind (income vs expense). Empty array = nothing unusual.
 */
export function detectAnomalies(
  candidate: AnomalyCandidate,
  recent: AnomalyCandidate[],
): Anomaly[] {
  const flags: Anomaly[] = [];
  if (isDuplicate(candidate, recent)) flags.push({type: 'duplicate'});
  if (isRoundOutlier(candidate, recent)) flags.push({type: 'round-outlier'});
  return flags;
}
