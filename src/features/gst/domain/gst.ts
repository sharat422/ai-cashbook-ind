import {tNow} from '@/i18n';
/**
 * Input checks mirrored from the server (backend/app/gst.py) so a GST invoice
 * saved offline doesn't fail later at sync. Tax itself is computed only by the
 * server — never here.
 */

/** Slabs in force since 22 Sep 2025 (GST 2.0). 12% and 28% have ended; the
 *  server still accepts them on invoices dated before they ended. */
export const GST_RATES = ['0', '5', '18', '40'] as const;

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const HSN_RE = /^(\d{4}|\d{6}|\d{8})$/;
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

/** GST Unique Quantity Codes (as backend/app/gst.py UQC). */
export const UQC_CODES = ['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM',
  'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR',
  'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM',
  'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS'] as const;

/** Best guess of the UQC for an item's free-text unit ("box", "kg", "pcs"…). */
export function uqcForUnit(unit?: string | null): string | null {
  const u = (unit ?? '').trim().toLowerCase().replace(/\.$/, '');
  const map: Record<string, string> = {
    box: 'BOX', boxes: 'BOX', bag: 'BAG', bags: 'BAG', bottle: 'BTL', btl: 'BTL', can: 'CAN',
    carton: 'CTN', ctn: 'CTN', dozen: 'DOZ', doz: 'DOZ', kg: 'KGS', kgs: 'KGS', kilo: 'KGS',
    g: 'GMS', gm: 'GMS', gram: 'GMS', l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR',
    ml: 'MLT', m: 'MTR', mtr: 'MTR', metre: 'MTR', nos: 'NOS', no: 'NOS', pc: 'PCS', pcs: 'PCS',
    piece: 'PCS', pieces: 'PCS', pack: 'PAC', packet: 'PAC', pkt: 'PAC', pair: 'PRS', set: 'SET',
    roll: 'ROL', ton: 'TON', tonne: 'TON', quintal: 'QTL', unit: 'UNT', units: 'UNT', tube: 'TUB',
  };
  const code = u.toUpperCase();
  return map[u] ?? ((UQC_CODES as readonly string[]).includes(code) ? code : null);
}

export type GstField = 'gstin' | 'hsn' | 'quantity' | 'uqc';

/** First problem with a GST invoice's inputs, or null when it can be saved.
 *  The invoice number isn't one: the server assigns it (Rule 46). */
export function gstInputError(
  gst: {hsn: string; customerGstin?: string; quantity?: string; uqc?: string},
): {field: GstField; message: string} | null {
  const qty = Number(gst.quantity);
  if (!gst.quantity || !Number.isFinite(qty) || qty <= 0) {
    return {field: 'quantity', message: tNow('errors.gstQuantity')};
  }
  if (!gst.uqc || !(UQC_CODES as readonly string[]).includes(gst.uqc)) {
    return {field: 'uqc', message: tNow('errors.gstUqc')};
  }
  if (gst.customerGstin && !isValidGstin(gst.customerGstin)) {
    return {field: 'gstin', message: tNow('errors.gstinCheck')};
  }
  if (!HSN_RE.test(gst.hsn.replace(/\s/g, ''))) {
    return {field: 'hsn', message: tNow('errors.hsn')};
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
