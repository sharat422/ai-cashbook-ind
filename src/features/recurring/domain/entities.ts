/**
 * Domain entities for Recurring Expenses (#24). Pure data + types.
 *
 * A template captures a repeating expense (rent, salary, subscriptions…) with a
 * cadence; the backend computes the next due date and can "post" an occurrence
 * as a real expense.
 */

import type {TKey, TranslateFn} from '@/i18n';

export const RECURRING_FREQUENCIES = [
  'weekly',
  'monthly',
  'yearly',
  'custom',
] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** "Every month", "Every 2 weeks", "Every 10 days"…, in the user's language. */
export function frequencyLabel(
  t: TranslateFn,
  frequency: RecurringFrequency,
  interval: number,
): string {
  return interval === 1
    ? t(`recurring.every.${frequency}` as TKey)
    : t(`recurring.everyN.${frequency}` as TKey, {n: interval});
}

/** What the user fills in on the form. */
export interface RecurringDraft {
  name: string;
  /** Amount in whole INR (rupees). */
  amount: number;
  category: string;
  vendor: string;
  frequency: RecurringFrequency;
  /** Every N units (>= 1). */
  interval: number;
  /** ISO date (YYYY-MM-DD) of the next time it's due. */
  nextDueDate: string;
  notes?: string;
  active: boolean;
}

/** A persisted recurring-expense template (server-computed fields included). */
export interface RecurringExpense extends RecurringDraft {
  id: string;
  /** Intended day-of-month for monthly templates (server-derived). */
  anchorDay: number | null;
  lastPostedDate: string | null;
  /** True when the next occurrence has arrived (and the template is active). */
  isDue: boolean;
  createdAt: string;
}

export interface RecurringList {
  items: RecurringExpense[];
  /** How many templates are due now. */
  dueCount: number;
  /** Sum of amounts currently due. */
  dueTotal: number;
  /** Rough monthly run-rate of all active templates. */
  monthlyTotal: number;
}
