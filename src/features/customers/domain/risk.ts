/**
 * On-device payment-risk prediction engine. Transparent, explainable scoring
 * derived from a customer's ledger — no network needed. The feature set and
 * weights are documented so the score can be reasoned about (and a server model
 * could replace `predictRisk` later without touching the UI).
 */
import type {Customer} from './entities';
import type {CustomerLedger} from './ledger';
import {todayIST} from '@utils/date';
import {tNow} from '@/i18n';

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
  const today = todayIST();

  const credits = asc.filter(e => e.type === 'credit');
  const payments = asc.filter(e => e.type === 'payment');

  // FIFO allocation: a small payment must not settle every earlier credit.
  // Weight the delay by value and include the still-unpaid balance's age.
  const remaining = payments.map(p => ({...p, available: p.amount}));
  let weightedDelay = 0;
  let creditValue = 0;
  // Payments are used up oldest-first, so the used-up ones are always a
  // prefix: skip past them instead of rescanning (O(n), not O(credits × payments)
  // — a 1,000-entry ledger froze low-end phones).
  let next = 0;
  for (const c of credits) {
    let unpaid = c.amount;
    creditValue += c.amount;
    while (unpaid > 0 && next < remaining.length) {
      const p = remaining[next];
      const applied = Math.min(unpaid, p.available);
      weightedDelay += applied * Math.max(0, daysBetween(c.date, p.date));
      unpaid -= applied;
      p.available -= applied;
      if (p.available <= 0) { next += 1; }
    }
    weightedDelay += unpaid * Math.max(0, daysBetween(c.date, today));
  }
  const avgPaymentDelayDays = creditValue ? weightedDelay / creditValue : 0;

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
      label: tNow('risk.f.slow', {n: Math.round(features.avgPaymentDelayDays)}),
      impact: 'increase',
    });
  } else if (features.avgPaymentDelayDays <= 7 && features.historyCount > 0) {
    factors.push({label: tNow('risk.f.quick'), impact: 'decrease'});
  }

  const overduePts = features.isOverdue ? 20 : 0;
  if (features.isOverdue) {
    factors.push({label: tNow('risk.f.overdue'), impact: 'increase'});
  }

  const paybackPts = (1 - features.paymentRatio) * 20;
  if (features.paymentRatio < 0.5 && features.outstandingAmount > 0) {
    factors.push({label: tNow('risk.f.lowPayback'), impact: 'increase'});
  } else if (features.paymentRatio >= 0.9) {
    factors.push({label: tNow('risk.f.strong'), impact: 'decrease'});
  }

  const exposurePts = clamp(features.outstandingAmount / 100_000, 0, 1) * 10;
  if (features.outstandingAmount >= 50_000) {
    factors.push({label: tNow('risk.f.exposure'), impact: 'increase'});
  }

  const frequencyPts = -clamp(features.transactionFrequencyPerMonth / 4, 0, 1) * 10;
  if (features.transactionFrequencyPerMonth >= 4) {
    factors.push({label: tNow('risk.f.frequent'), impact: 'decrease'});
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
  if (features.isOverdue) actions.push(tNow('risk.a.overdueNow'));

  if (category === 'high') {
    actions.push(
      tNow('risk.a.partial'),
      tNow('risk.a.hold'),
      tNow('risk.a.call'),
    );
  } else if (category === 'medium') {
    actions.push(
      tNow('risk.a.dueReminder'),
      tNow('risk.a.dueDate'),
      tNow('risk.a.limit'),
    );
  } else {
    actions.push(
      tNow('risk.a.healthy'),
      tNow('risk.a.friendly'),
    );
  }
  return actions;
}
