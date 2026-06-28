import {EXPENSE_CATEGORIES, type ExpenseDraft} from './entities';

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
    errors.amount = 'Enter an amount';
  } else if (draft.amount <= 0) {
    errors.amount = 'Amount must be greater than ₹0';
  } else if (draft.amount > MAX_AMOUNT) {
    errors.amount = 'Amount looks too large';
  }

  if (!draft.category || !EXPENSE_CATEGORIES.includes(draft.category)) {
    errors.category = 'Select a category';
  }

  if (!draft.date) {
    errors.date = 'Select a date';
  } else if (Number.isNaN(Date.parse(draft.date))) {
    errors.date = 'Invalid date';
  } else if (new Date(draft.date) > new Date()) {
    errors.date = 'Date cannot be in the future';
  }

  if (!draft.vendor || !draft.vendor.trim()) {
    errors.vendor = 'Enter a vendor / payee';
  } else if (draft.vendor.trim().length > 80) {
    errors.vendor = 'Vendor must be 80 characters or fewer';
  }

  if (draft.notes && draft.notes.length > 280) {
    errors.notes = 'Notes must be 280 characters or fewer';
  }

  return errors;
}
