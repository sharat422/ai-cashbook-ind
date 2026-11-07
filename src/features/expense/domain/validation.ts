import {todayIST} from '@utils/date';
import {EXPENSE_CATEGORIES, type ExpenseDraft} from './entities';
import {tNow} from '@/i18n';

export type ExpenseFieldErrors = Partial<Record<keyof ExpenseDraft, string>>;

/** Maximum single expense entry we accept (₹1 crore) — guards typos. */
const MAX_AMOUNT = 10_000_000;

/**
 * Pure validation of an expense draft. Returns a map of field -> message;
 * an empty object means valid. Shared by the form (live) and the use case
 * (authoritative).
 */
export function validateExpenseDraft(draft: ExpenseDraft): ExpenseFieldErrors {
  const errors: ExpenseFieldErrors = {};

  if (draft.amount === undefined || Number.isNaN(draft.amount)) {
    errors.amount = tNow('errors.amountRequired');
  } else if (draft.amount <= 0) {
    errors.amount = tNow('errors.amountPositive');
  } else if (draft.amount > MAX_AMOUNT) {
    errors.amount = tNow('errors.amountTooLarge');
  }

  if (!draft.category || !EXPENSE_CATEGORIES.includes(draft.category)) {
    errors.category = tNow('errors.categoryRequired');
  }

  if (!draft.date) {
    errors.date = tNow('errors.dateRequired');
  } else if (Number.isNaN(Date.parse(draft.date))) {
    errors.date = tNow('errors.dateInvalid');
  } else if (draft.date.slice(0, 10) > todayIST()) {
    errors.date = tNow('errors.dateFuture');
  }

  // Vendor is optional (quick-add lets you save with just an amount); only the
  // length cap is enforced when one is provided.
  if (draft.vendor && draft.vendor.trim().length > 80) {
    errors.vendor = tNow('errors.tooLong', {n: 80});
  }

  if (draft.notes && draft.notes.length > 5000) {
    errors.notes = tNow('errors.tooLong', {n: 5000});
  }

  return errors;
}
