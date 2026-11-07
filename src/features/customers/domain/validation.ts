import {validateMobile} from '@utils/validation';
import type {CustomerDraft} from './entities';
import {tNow} from '@/i18n';

export type CustomerFieldErrors = Partial<Record<keyof CustomerDraft, string>>;

/** Standard 15-char GSTIN, e.g. 29ABCDE1234F1Z5. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Pure validation of a customer draft. Empty object = valid. Shared by the form
 * (live) and the use cases (authoritative).
 */
export function validateCustomerDraft(
  draft: CustomerDraft,
): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {};

  if (!draft.fullName.trim()) {
    errors.fullName = tNow('errors.nameRequired');
  } else if (draft.fullName.trim().length > 80) {
    errors.fullName = tNow('errors.tooLong', {n: 80});
  }

  const mobileError = validateMobile(draft.mobile);
  if (mobileError) errors.mobile = mobileError;

  if (draft.gstNumber && draft.gstNumber.trim()) {
    if (!GSTIN.test(draft.gstNumber.trim().toUpperCase())) {
      errors.gstNumber = tNow('errors.gstinInvalid');
    }
  }

  if (draft.notes && draft.notes.length > 500) {
    errors.notes = tNow('errors.tooLong', {n: 500});
  }

  return errors;
}
