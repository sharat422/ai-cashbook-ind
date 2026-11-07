import {apiRequest} from '@api/client';

/** Exact strings from the server: money "12.50", quantity "2.000". */
export type Money = string;
export type Qty = string;

export type SchemeType = 'buy_get' | 'slab' | 'percent' | 'free_goods';

export interface Scheme {
  id: string;
  name: string;
  type: SchemeType;
  itemIds: string[];
  validFrom: string;
  validTo: string;
  /** 1 wins over 2 when two schemes could apply to the same line. */
  priority: number;
  active: boolean;
  buyQty: Qty | null;
  freeQty: Qty | null;
  freeItemId: string | null;
  minQty: Qty | null;
  percent: string | null;
  slabs: [string, string][] | null;
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
}

export interface PreviewLine {
  itemId: string;
  name: string;
  unit: string | null;
  quantity: Qty;
  rate: Money;
  amount: Money;
  scheme: SchemeLine | null;
  notApplied: {schemeId: string; name: string; reason: string}[];
}

export interface BillPreview {
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
  lines: {itemId: string; name: string; unit: string | null; quantity: Qty; rate: Money; amount: Money}[];
  schemes: SchemeApplication[];
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
  log: (from: string, to: string, customerId?: string) =>
    apiRequest<SchemeApplication[]>(`/schemes/log?${qs({from, to, customerId})}`, {method: 'GET'}),
  report: (from: string, to: string, schemeId?: string, itemId?: string) =>
    apiRequest<SchemeReport>(`/schemes/report?${qs({from, to, schemeId, itemId})}`, {method: 'GET'}),
};
