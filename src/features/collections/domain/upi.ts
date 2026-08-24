/**
 * UPI deep-link helpers. A `upi://pay?...` URI opens any UPI app (GPay, PhonePe,
 * Paytm, BHIM…) pre-filled to pay the merchant — no payment gateway required.
 * The same string is encoded into a QR the customer can scan.
 */

export interface UpiRequest {
  /** Payee VPA / UPI ID, e.g. shop@okhdfcbank. */
  payeeVpa: string;
  /** Payee display name. */
  payeeName: string;
  /** Amount in INR (omitted for an open-amount request). */
  amount?: number;
  /** Human note shown in the UPI app (tn). */
  note?: string;
  /** Merchant transaction reference (tr). */
  ref?: string;
}

/** Build a `upi://pay` URI from a request. */
export function buildUpiUri(r: UpiRequest): string {
  const params: Array<[string, string | undefined]> = [
    ['pa', r.payeeVpa.trim()],
    ['pn', r.payeeName.trim()],
    ['am', r.amount && r.amount > 0 ? String(r.amount) : undefined],
    ['tn', r.note],
    ['tr', r.ref],
    ['cu', 'INR'],
  ];
  const qs = params
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `upi://pay?${qs}`;
}

/** Loose VPA validation (name@handle). */
export function isValidUpiId(vpa: string): boolean {
  return /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim());
}

/** A short, human transaction reference for a collection request. */
export function makePaymentRef(): string {
  return `SCB${Date.now().toString(36).toUpperCase().slice(-6)}`;
}
