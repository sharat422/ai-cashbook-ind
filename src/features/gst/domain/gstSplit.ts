/**
 * The GST tax split, computed on the phone with exactly the server's formula
 * (backend/app/gst.py `split`), so an invoice saved offline shows the right
 * balance before it syncs. Integer paise with BigInt — no floating point —
 * and half-up rounding to the paisa, like the server's Decimal.
 * gstSplitVectors.json (generated from the server) pins the two together.
 */

/** GST state codes (first two digits of a GSTIN), as in backend/app/gst.py. */
export const GST_STATE_CODES: Record<string, string> = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04',
  Uttarakhand: '05', Haryana: '06', Delhi: '07', Rajasthan: '08', 'Uttar Pradesh': '09',
  Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14',
  Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19',
  Jharkhand: '20', Odisha: '21', Chhattisgarh: '22', 'Madhya Pradesh': '23', Gujarat: '24',
  'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29',
  Goa: '30', Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33', Puducherry: '34',
  'Andaman and Nicobar Islands': '35', Telangana: '36', 'Andhra Pradesh': '37', Ladakh: '38',
};

export interface GstSplit {
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

/** Exact decimal string → integer in units of 10^-scale (truncating beyond). */
function scaled(value: string, scale: number): bigint {
  const [whole, frac = ''] = value.trim().split('.');
  return BigInt(whole + frac.padEnd(scale, '0').slice(0, scale));
}

/** round_half_up(n / d) for n, d > 0. */
const div = (n: bigint, d: bigint): bigint => (2n * n + d) / (2n * d);

/** Paise → "1234.50". */
const rupees = (p: bigint): string => `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;

export function gstSplit(amount: number | string, rate: string, inclusive: boolean, interState: boolean): GstSplit {
  // The server receives String(amount) and rounds it half-up to the paisa first.
  const a = div(scaled(String(amount), 6), 10_000n); // micro-rupees → paise
  const r = scaled(rate, 2); // 18 → 1800, 0.25 → 25
  let taxable: bigint;
  let igst = 0n;
  let half = 0n;
  if (inclusive) {
    // tax = amount × rate / (100 + rate)
    if (interState) igst = div(a * r, 10_000n + r);
    else half = div(a * r, 2n * (10_000n + r));
    taxable = a - igst - 2n * half;
  } else {
    taxable = a;
    if (interState) igst = div(a * r, 10_000n);
    else half = div(a * r, 20_000n);
  }
  return {
    taxableValue: rupees(taxable),
    cgst: rupees(half),
    sgst: rupees(half),
    igst: rupees(igst),
    total: rupees(taxable + 2n * half + igst),
  };
}

/**
 * Place of supply exactly as the server picks it: the customer's GSTIN state,
 * else the state picked for an unregistered customer, else the seller's own.
 */
export function placeOfSupply(sellerGstin: string, customerGstin?: string, customerState?: string): string {
  if (customerGstin) return customerGstin.slice(0, 2);
  if (customerState && GST_STATE_CODES[customerState]) return GST_STATE_CODES[customerState];
  return sellerGstin.slice(0, 2);
}
