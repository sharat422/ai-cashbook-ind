import {apiRequest} from '@api/client';

/** Exact strings from the server: money "12.50", quantity "2.000". */
export type Money = string;
export type Qty = string;

export type SchemeType = 'buy_get' | 'slab' | 'percent' | 'free_goods' | 'amount_off';

export interface Scheme {
  id: string;
  name: string;
  type: SchemeType;
  itemIds: string[];
  /** The items' names, in itemIds order (from the server: no catalogue load). */
  itemNames?: string[];
  validFrom: string;
  validTo: string;
  /** 1 wins over 2 when two schemes could apply to the same line. */
  priority: number;
  active: boolean;
  buyQty: Qty | null;
  freeQty: Qty | null;
  freeItemId: string | null;
  freeItemName?: string | null;
  minQty: Qty | null;
  percent: string | null;
  slabs: [string, string][] | null;
  /** single_sku: each SKU on its own. sku_group: the SKUs count together ("any 10"). */
  scope?: 'single_sku' | 'sku_group';
  /** line: per bill line. bill: once per bill, on the total after line schemes. */
  level?: 'line' | 'bill';
  minBillValue?: Money | null;
  /** A bill scheme for one retailer only (null = all). */
  retailerId?: string | null;
  /** ₹ off the bill (bill level, type amount_off). */
  amountOff?: Money | null;
}

export type SchemeInput = Omit<Scheme, 'id'>;

export interface BillLineInput {
  itemId: string;
  quantity: string;
  rate?: string;
}

export interface BillInput {
  clientId?: string;
  customerId: string;
  date: string;
  location: 'godown' | 'van';
  vanUserId?: string;
  /** Billed from a beat day-list: counts in that beat's daily close. */
  beatId?: string;
  /** Sent from the offline queue: the server re-checks schemes against today. */
  queued?: boolean;
  lines: BillLineInput[];
}

export interface SchemeLine {
  schemeId: string;
  name: string;
  type: SchemeType;
  freeItemId: string | null;
  freeItemName: string | null;
  freeQty: Qty;
  discount: Money;
  value: Money;
  /** A group scheme: "6 Soap A + 4 Soap B = 10 · free: Soap B". */
  group?: string | null;
}

export interface PreviewLine {
  itemId: string;
  name: string;
  unit: string | null;
  quantity: Qty;
  rate: Money;
  /** Typed on the bill, not the item's sale price. */
  rateChanged?: boolean;
  amount: Money;
  scheme: SchemeLine | null;
  notApplied: {schemeId: string; name: string; reason: string}[];
}

export interface BillPreview {
  /** The bill-level scheme applied (its own line), and the ones it beat. */
  billScheme?: {schemeId: string; name: string; type: SchemeType; discount: Money} | null;
  billNotApplied?: {schemeId: string; name: string; reason: string}[];
  lines: PreviewLine[];
  subtotal: Money;
  discount: Money;
  total: Money;
}

/** One row of the scheme log: applied, or not applied with the reason. */
export interface SchemeApplication {
  id: string;
  billId: string;
  billNumber?: string;
  customerId: string;
  date: string;
  schemeId: string;
  schemeName: string;
  schemeType: SchemeType;
  itemId: string;
  itemName: string;
  status: 'applied' | 'not_applied';
  reason: string | null;
  quantity: Qty;
  freeItemId: string | null;
  freeItemName: string | null;
  freeQty: Qty;
  discount: Money;
  value: Money;
  groupNote?: string | null;
}

/** Bill numbers: {prefix}-{financialYear}-{n}, e.g. "SB-26-27-1". */
export interface BillSeries {
  prefix: string;
  financialYear: string;
  nextNumber: string;
}

export interface Bill {
  id: string;
  billNumber: string;
  customerId: string;
  date: string;
  subtotal: Money;
  discount: Money;
  total: Money;
  ledgerEntryId: string | null;
  lines: {itemId: string; name: string; unit: string | null; quantity: Qty; rate: Money; amount: Money;
    /** The rate was typed on the bill, not the catalogue price. */
    rateChanged?: boolean;
    /** On the original, once that line was returned. */
    returned?: boolean}[];
  schemes: SchemeApplication[];
  /** cancelled | partly_returned (the original); a return points at what it reverses. */
  status?: 'cancelled' | 'partly_returned' | null;
  reversesId?: string | null;
  reversals?: {id: string; billNumber: string; date: string; total: Money}[];
}

export interface SchemeReportRow {
  schemeId: string;
  schemeName: string;
  schemeType: SchemeType;
  itemId: string;
  itemName: string;
  bills: number;
  quantity: Qty;
  freeQty: Qty;
  discount: Money;
  value: Money;
}

export interface SchemeReport {
  from: string;
  to: string;
  rows: SchemeReportRow[];
  totalDiscount: Money;
  totalValue: Money;
  totalFreeQty: Qty;
}

const qs = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');

export const schemesRemote = {
  list: () => apiRequest<Scheme[]>('/schemes', {method: 'GET'}),
  create: (input: SchemeInput) => apiRequest<Scheme>('/schemes', {method: 'POST', body: input}),
  update: (id: string, input: SchemeInput) =>
    apiRequest<Scheme>(`/schemes/${id}`, {method: 'PATCH', body: input}),
  remove: (id: string) => apiRequest<void>(`/schemes/${id}`, {method: 'DELETE'}),
  preview: (input: BillInput) => apiRequest<BillPreview>('/bills/preview', {method: 'POST', body: input}),
  createBill: (input: BillInput) => apiRequest<Bill>('/bills', {method: 'POST', body: input}),
  getBill: (id: string) => apiRequest<Bill>(`/bills/${id}`, {method: 'GET'}),
  /** The bill number prefix and the next number this financial year. */
  billSeries: () => apiRequest<BillSeries>('/bill-series', {method: 'GET'}),
  /** Owner: the prefix for new bills (old bills keep their numbers). */
  setBillPrefix: (prefix: string) => apiRequest<BillSeries>('/bill-series', {method: 'PUT', body: {prefix}}),
  /** The check before the bill PDF is shared (sharePdf only): 409 without consent for
   *  WhatsApp or the open share sheet; always logged; a short-lived `pdfUrl` on success. */
  shareBill: (id: string, channel: string) =>
    apiRequest<{status: 'ready'; mobile: string; pdfUrl: string; message: string}>(`/bills/${id}/share`,
      {method: 'POST', body: {channel}}),
  /** Cancel the bill, or return the lines with these item ids — by a reversal bill. */
  cancelBill: (id: string, itemIds: string[]) =>
    apiRequest<Bill>(`/bills/${id}/cancel`, {method: 'POST', body: {itemIds}}),
  log: (from: string, to: string, customerId?: string) =>
    apiRequest<SchemeApplication[]>(`/schemes/log?${qs({from, to, customerId})}`, {method: 'GET'}),
  report: (from: string, to: string, schemeId?: string, itemId?: string) =>
    apiRequest<SchemeReport>(`/schemes/report?${qs({from, to, schemeId, itemId})}`, {method: 'GET'}),
};
