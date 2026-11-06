/**
 * Input checks mirrored from the server (backend/app/gst.py) so a GST invoice
 * saved offline doesn't fail later at sync. Tax itself is computed only by the
 * server — never here.
 */

/** Rates the app offers; the server holds the full list. Confirm with the CA. */
export const GST_RATES = ['0', '5', '12', '18', '28', '40'] as const;

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const HSN_RE = /^(\d{4}|\d{6}|\d{8})$/;
const INVOICE_RE = /^[A-Za-z0-9/-]{1,16}$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const cleanGstin = (value: string): string => value.replace(/\s/g, '').toUpperCase();

export function isValidGstin(value: string): boolean {
  const v = cleanGstin(value);
  if (!GSTIN_RE.test(v)) return false;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(v[i]) * (i % 2 ? 2 : 1);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (total % 36)) % 36] === v[14];
}

export type GstField = 'invoice' | 'gstin' | 'hsn';

/** First problem with a GST invoice's inputs, or null when it can be saved. */
export function gstInputError(
  invoiceNumber: string | undefined,
  gst: {hsn: string; customerGstin?: string},
): {field: GstField; message: string} | null {
  if (!INVOICE_RE.test((invoiceNumber ?? '').trim())) {
    return {field: 'invoice', message: 'A GST invoice needs an invoice number: up to 16 letters, digits, / or -.'};
  }
  if (gst.customerGstin && !isValidGstin(gst.customerGstin)) {
    return {field: 'gstin', message: 'Check the GSTIN: 15 characters, like 29ABCDE1234F1Z5.'};
  }
  if (!HSN_RE.test(gst.hsn.replace(/\s/g, ''))) {
    return {field: 'hsn', message: 'Enter the HSN/SAC code: 4, 6 or 8 digits.'};
  }
  return null;
}

/** Fields per record in the Tally sheet the CA checks (date, party, GSTIN,
 *  HSN, taxable, CGST, SGST, IGST, bill reference). */
export const TALLY_FIELDS = 9;

export type CaVerdict = 'pending' | 'pass' | 'needs-fixes' | 'fail';

/**
 * The CA test for a pilot month: every exported record imports into Tally and
 * nothing is re-typed = pass. More than 10% of fields re-typed, or records that
 * didn't import, = fail. Anything in between needs fixes before shipping.
 */
export function caTestVerdict(exported: number, imported?: number, retyped?: number): {
  verdict: CaVerdict;
  retypedShare: number;
} {
  if (!exported || imported === undefined || retyped === undefined) {
    return {verdict: 'pending', retypedShare: 0};
  }
  const retypedShare = retyped / (exported * TALLY_FIELDS);
  const verdict =
    imported < exported || retypedShare > 0.1 ? 'fail' : retyped === 0 ? 'pass' : 'needs-fixes';
  return {verdict, retypedShare};
}
