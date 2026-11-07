import {todayIST} from '@utils/date';
import {INCOME_CATEGORIES, type IncomeDraft} from './entities';
import {tNow} from '@/i18n';

export type IncomeFieldErrors = Partial<
  Record<keyof IncomeDraft, string>
>;

/** Maximum single income entry we accept (₹1 crore) — guards typos. */
const MAX_AMOUNT = 10_000_000;

/**
 * Pure validation of an income draft. Returns a map of field -> message;
 * an empty object means valid. Shared by the form (live) and the use case
 * (authoritative).
 */
export function validateIncomeDraft(draft: IncomeDraft): IncomeFieldErrors {
  const errors: IncomeFieldErrors = {};

  if (draft.amount === undefined || Number.isNaN(draft.amount)) {
    errors.amount = tNow('errors.amountRequired');
  } else if (draft.amount <= 0) {
    errors.amount = tNow('errors.amountPositive');
  } else if (draft.amount > MAX_AMOUNT) {
    errors.amount = tNow('errors.amountTooLarge');
  }

  if (!draft.category || !INCOME_CATEGORIES.includes(draft.category)) {
    errors.category = tNow('errors.categoryRequired');
  }

  if (!draft.date) {
    errors.date = tNow('errors.dateRequired');
  } else if (Number.isNaN(Date.parse(draft.date))) {
    errors.date = tNow('errors.dateInvalid');
  } else if (draft.date.slice(0, 10) > todayIST()) {
    errors.date = tNow('errors.dateFuture');
  }

  if (draft.notes && draft.notes.length > 280) {
    errors.notes = tNow('errors.tooLong', {n: 280});
  }

  return errors;
}
