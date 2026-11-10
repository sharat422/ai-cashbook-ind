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
  location: Location;
  vanUserId?: string;
  date: string;
  note?: string;
  /** Required for a purchase. */
  supplier?: string;
  unitPrice?: string;
  billRef?: string;
}

export interface TransferInput {
  clientId: string;
  itemId: string;
  quantity: string;
  vanUserId: string;
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

export const stockRemote = {
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
};
