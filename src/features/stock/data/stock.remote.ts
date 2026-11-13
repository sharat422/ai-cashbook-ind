import {apiRequest} from '@api/client';

/** Exact quantity string from the server, 3 decimals ("12.500"). */
export type Qty = string;

export interface StockItem {
  id: string;
  name: string;
  unit: string | null;
  purchasePrice: number;
  salePrice: number;
  lowStockThreshold: Qty | null;
  godown: Qty;
  /** Van stock by salesperson user id (non-zero only). */
  vans: Record<string, Qty>;
  total: Qty;
  low: boolean;
  /** Other units, as base units each (box = 24 when the base `unit` is pcs). */
  units?: {unit: string; factor: Qty}[];
  /** The total read in those units: "8 box 18 pcs". */
  display?: string;
}

export interface Van {
  userId: string;
  mobile: string;
  role: string;
  /** The owner's name for this person; label vans with personLabel(). */
  name: string | null;
}

export interface VanItem {
  id: string;
  name: string;
  unit: string | null;
  salePrice: number;
  quantity: Qty;
}

export type Location = 'godown' | 'van';

export interface StockMove {
  id: string;
  itemId: string;
  location: Location;
  vanUserId: string | null;
  kind: 'opening' | 'purchase' | 'sale' | 'transfer' | 'count';
  quantity: Qty;
  date: string;
  groupId: string | null;
  counted: Qty | null;
  note: string | null;
  /** As entered, when not in the base unit ("10 box" for 240 pcs). */
  enteredUnit?: string | null;
  enteredQty?: Qty | null;
  /** A reversal row points at the entry it undoes; an undone entry is marked reversed. */
  reversesId?: string | null;
  reversed?: boolean;
  /** Purchases: who from, price per unit, and their bill number. */
  supplier: string | null;
  unitPrice: string | null;
  billRef: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CountLineResult {
  itemId: string;
  system: Qty;
  counted: Qty;
  difference: Qty;
  differencePct: string | null;
  withinTolerance: boolean;
}

export interface CountResult {
  date: string;
  location: Location;
  vanUserId: string | null;
  lines: CountLineResult[];
  allWithinTolerance: boolean;
}

export interface MoveInput {
  clientId: string;
  kind: 'purchase' | 'sale';
  itemId: string;
  quantity: string;
  /** One of the item's units (default: its base unit); stock is held in base units. */
  unit?: string;
  location: Location;
  vanUserId?: string;
  date: string;
  note?: string;
  /** Required for a purchase: picked from the list (supplierId), or a name (a new one is added). */
  supplierId?: string;
  supplier?: string;
  unitPrice?: string;
  billRef?: string;
  /** Optional GST from the supplier's bill (rate and amount together), for the CA's ITC review. */
  supplierGstin?: string;
  gstRate?: string;
  gstAmount?: string;
}

/** godown → van (the default), van → godown or van → van. */
export interface TransferInput {
  clientId: string;
  itemId: string;
  quantity: string;
  unit?: string;
  fromLocation?: 'godown' | 'van';
  fromVanUserId?: string;
  toLocation?: 'godown' | 'van';
  /** The destination van. */
  vanUserId?: string;
  date: string;
  note?: string;
}

export interface CountInput {
  clientId: string;
  location: Location;
  vanUserId?: string;
  date: string;
  lines: {itemId: string; counted: string}[];
}

/** Who the business buys from. */
export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
}

/** The month's count: due (last 3 days), counted, locked, and who last locked / unlocked it. */
export interface MonthStatus {
  month: string;
  counted: boolean;
  locked: boolean;
  reminderDue: boolean;
  lockedAt: string | null;
  lockedBy: {userId: string; name: string | null} | null;
  unlockedAt: string | null;
  unlockedBy: {userId: string; name: string | null} | null;
}

export const stockRemote = {
  monthStatus: (date?: string) =>
    apiRequest<MonthStatus>(`/stock/month-status${date ? `?date=${date}` : ''}`, {method: 'GET'}),
  lockMonth: (month: string) => apiRequest<MonthStatus>(`/stock/months/${month}/lock`, {method: 'POST'}),
  unlockMonth: (month: string) => apiRequest<MonthStatus>(`/stock/months/${month}/unlock`, {method: 'POST'}),
  suppliers: () => apiRequest<Supplier[]>('/suppliers', {method: 'GET'}),
  levels: () => apiRequest<{items: StockItem[]; vans: Van[]}>('/stock', {method: 'GET'}),
  low: () => apiRequest<StockItem[]>('/stock/low', {method: 'GET'}),
  van: (userId?: string) =>
    apiRequest<VanItem[]>(`/stock/van${userId ? `?userId=${userId}` : ''}`, {method: 'GET'}),
  moves: (itemId?: string) =>
    apiRequest<StockMove[]>(`/stock/moves${itemId ? `?itemId=${itemId}` : ''}`, {method: 'GET'}),
  record: (input: MoveInput) => apiRequest<StockMove[]>('/stock/moves', {method: 'POST', body: input}),
  transfer: (input: TransferInput) =>
    apiRequest<StockMove[]>('/stock/transfers', {method: 'POST', body: input}),
  count: (input: CountInput) => apiRequest<CountResult>('/stock/counts', {method: 'POST', body: input}),
  /** Undo an entry with a reversal (never an edit). */
  reverse: (moveId: string) => apiRequest<StockMove[]>(`/stock/moves/${moveId}/reverse`, {method: 'POST'}),
};
