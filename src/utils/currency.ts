/** INR (Indian Rupee) currency helpers, including lakh/crore grouping. */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const INR_GROUP = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});

/** Format a number as ₹ with Indian digit grouping, e.g. 1234567 -> "₹12,34,567". */
export function formatINR(amount: number): string {
  if (Number.isNaN(amount)) return '₹0';
  return INR.format(amount);
}

/** Group digits the Indian way without the symbol, e.g. "1234567" -> "12,34,567". */
export function groupINR(digits: string): string {
  const n = Number(digits);
  if (!digits || Number.isNaN(n)) return '';
  return INR_GROUP.format(n);
}

/** Strip everything but digits — for parsing user input back to a number. */
export function parseAmount(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : NaN;
}
