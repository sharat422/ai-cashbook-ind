import {INCOME_CATEGORIES, type IncomeDraft} from './entities';

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
    errors.amount = 'Enter an amount';
  } else if (draft.amount <= 0) {
    errors.amount = 'Amount must be greater than ₹0';
  } else if (draft.amount > MAX_AMOUNT) {
    errors.amount = 'Amount looks too large';
  }

  if (!draft.category || !INCOME_CATEGORIES.includes(draft.category)) {
    errors.category = 'Select a category';
  }

  if (!draft.date) {
    errors.date = 'Select a date';
  } else if (Number.isNaN(Date.parse(draft.date))) {
    errors.date = 'Invalid date';
  } else if (new Date(draft.date) > new Date()) {
    errors.date = 'Date cannot be in the future';
  }

  if (draft.notes && draft.notes.length > 280) {
    errors.notes = 'Notes must be 280 characters or fewer';
  }

  return errors;
}
