import {tNow} from '@/i18n';
/** Validation helpers shared across forms. All return a string error or null. */

/** Indian mobile numbers: 10 digits starting 6-9. */
export function validateMobile(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return tNow('errors.mobileRequired');
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return tNow('errors.mobileInvalid');
  }
  return null;
}

export function validateOtp(value: string, length: number): string | null {
  if (!value) return tNow('errors.otpRequired');
  if (!new RegExp(`^\\d{${length}}$`).test(value)) {
    return tNow('errors.otpLength', {n: length});
  }
  return null;
}

export function validateRequired(
  value: string,
  label: string,
): string | null {
  return value.trim() ? null : tNow('errors.required', {label});
}

/** Keep only digits — handy for controlled numeric inputs. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}
