/** Validation helpers shared across forms. All return a string error or null. */

/** Indian mobile numbers: 10 digits starting 6-9. */
export function validateMobile(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 'Mobile number is required';
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return 'Enter a valid 10-digit mobile number';
  }
  return null;
}

export function validateOtp(value: string, length: number): string | null {
  if (!value) return 'OTP is required';
  if (!new RegExp(`^\\d{${length}}$`).test(value)) {
    return `Enter the ${length}-digit OTP`;
  }
  return null;
}

export function validateRequired(
  value: string,
  label: string,
): string | null {
  return value.trim() ? null : `${label} is required`;
}

/** Keep only digits — handy for controlled numeric inputs. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}
