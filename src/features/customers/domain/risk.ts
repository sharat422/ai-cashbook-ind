/**
 * On-device payment-risk prediction engine. Transparent, explainable scoring
 * derived from a customer's ledger — no network needed. The feature set and
 * weights are documented so the score can be reasoned about (and a server model
 * could replace `predictRisk` later without touching the UI).
 */
import type {Customer} from './entities';
import type {CustomerLedger} from './ledger';

export type RiskCategory = 'low' | 'medium' | 'high';

/** The four model inputs, derived from the ledger. */
export interface RiskFeatures {
  outstandingAmount: number;
  /** Average days a credit waits before being paid (open credits → days so far). */
  avgPaymentDelayDays: number;
  /** Transactions per month over the active period. */
  transactionFrequencyPerMonth: number;
  /** Share of credited value that has been paid back, 0..1. */
  paymentRatio: number;
  /** Number of ledger entries — drives prediction confidence. */
  historyCount: number;
  isOverdue: boolean;
}

export interface RiskFactor {
  label: string;
  /** Whether this factor pushes risk up or down. */
  impact: 'increase' | 'decrease';
}

export interface RiskPrediction {
  /** 0 (safe) – 100 (very risky). */
  score: number;
  category: RiskCategory;
  /** Model confidence 0..1 (grows with data history). */
  confidence: number;
  factors: RiskFactor[];
  suggestedActions: string[];
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

/** Derive the risk feature set from a customer's ledger. */
export function deriveRiskFeatures(
  ledger: CustomerLedger,
  customer: Customer,
): RiskFeatures {
  // Oldest-first for time-based features.
  const asc = [...ledger.entries].reverse();
  const today = new Date().toISOString().slice(0, 10);

  const credits = asc.filter(e => e.type === 'credit');
  const payments = asc.filter(e => e.type === 'payment');

  // Average payment delay: for each credit, days until the next payment (or
  // days outstanding so far if not yet paid).
  let delaySum = 0;
  for (const c of credits) {
    const next = payments.find(p => p.date >= c.date);
    delaySum += Math.max(0, daysBetween(c.date, next ? next.date : today));
  }
  const avgPaymentDelayDays = credits.length ? delaySum / credits.length : 0;

  // Transaction frequency per month.
  const spanDays =
    asc.length >= 2 ? Math.max(1, daysBetween(asc[0].date, asc[asc.length - 1].date)) : 30;
  const months = Math.max(1, spanDays / 30);
  const transactionFrequencyPerMonth = asc.length / months;

  const paymentRatio =
    ledger.totalCredit > 0
      ? clamp(ledger.totalPayment / ledger.totalCredit, 0, 1)
      : 1;

  return {
    outstandingAmount: ledger.outstanding,
    avgPaymentDelayDays,
    transactionFrequencyPerMonth,
    paymentRatio,
    historyCount: asc.length,
    isOverdue: customer.isOverdue,
  };
}

function categoryOf(score: number): RiskCategory {
  if (score < 34) return 'low';
  if (score < 67) return 'medium';
  return 'high';
}

/**
 * Predict payment risk from the feature set. Weighted, bounded contributions:
 *  - payment delay  → up to +40
 *  - overdue flag   → +20
 *  - low payback    → up to +20
 *  - exposure       → up to +10
 *  - high frequency → up to −10 (engaged customers pay)
 */
export function predictRisk(features: RiskFeatures): RiskPrediction {
  const factors: RiskFactor[] = [];

  const delayPts = clamp(features.avgPaymentDelayDays / 60, 0, 1) * 40;
  if (features.avgPaymentDelayDays >= 30) {
    factors.push({
      label: `Slow payments (~${Math.round(features.avgPaymentDelayDays)}d avg)`,
      impact: 'increase',
    });
  } else if (features.avgPaymentDelayDays <= 7 && features.historyCount > 0) {
    factors.push({label: 'Pays quickly', impact: 'decrease'});
  }

  const overduePts = features.isOverdue ? 20 : 0;
  if (features.isOverdue) {
    factors.push({label: 'Balance is overdue', impact: 'increase'});
  }

  const paybackPts = (1 - features.paymentRatio) * 20;
  if (features.paymentRatio < 0.5 && features.outstandingAmount > 0) {
    factors.push({label: 'Low payback ratio', impact: 'increase'});
  } else if (features.paymentRatio >= 0.9) {
    factors.push({label: 'Strong repayment history', impact: 'decrease'});
  }

  const exposurePts = clamp(features.outstandingAmount / 100_000, 0, 1) * 10;
  if (features.outstandingAmount >= 50_000) {
    factors.push({label: 'High outstanding exposure', impact: 'increase'});
  }

  const frequencyPts = -clamp(features.transactionFrequencyPerMonth / 4, 0, 1) * 10;
  if (features.transactionFrequencyPerMonth >= 4) {
    factors.push({label: 'Frequent, active customer', impact: 'decrease'});
  }

  const score = Math.round(
    clamp(delayPts + overduePts + paybackPts + exposurePts + frequencyPts, 0, 100),
  );
  const category = categoryOf(score);

  // Confidence grows with available history (caps at ~10 entries).
  const confidence = Number(
    clamp(0.35 + Math.min(features.historyCount, 10) * 0.06, 0.35, 0.95).toFixed(2),
  );

  return {
    score,
    category,
    confidence,
    factors,
    suggestedActions: suggestActions(category, features),
  };
}

function suggestActions(
  category: RiskCategory,
  features: RiskFeatures,
): string[] {
  const actions: string[] = [];
  if (features.isOverdue) actions.push('Send an Overdue reminder now');

  if (category === 'high') {
    actions.push(
      'Request a partial settlement or a firm payment date',
      'Hold new credit until the balance clears',
      'Call the customer directly to follow up',
    );
  } else if (category === 'medium') {
    actions.push(
      'Send a Payment Due reminder',
      'Confirm a clear due date',
      'Keep new credit limited until the trend improves',
    );
  } else {
    actions.push(
      'Healthy payer — continue normal terms',
      'Optionally send a Friendly reminder near the due date',
    );
  }
  return actions;
}
