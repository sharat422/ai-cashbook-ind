/** Domain entities for the Item/product catalog (foundation for GST invoicing). */

export const ITEM_UNITS = [
  'pcs',
  'kg',
  'g',
  'ltr',
  'ml',
  'box',
  'bag',
  'pkt',
  'mtr',
  'hr',
  'day',
] as const;

/** Standard Indian GST slabs. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;

export type ItemType = 'product' | 'service';

export interface ItemDraft {
  name: string;
  type: ItemType;
  /** Selling price per unit (before tax). */
  salePrice: number;
  purchasePrice: number;
  unit?: string | null;
  /** HSN (goods) or SAC (services) code. */
  hsnSac?: string | null;
  /** GST rate percentage (0/5/12/18/28). */
  gstRate: number;
  trackStock: boolean;
  stockQty: number;
}

export interface Item extends ItemDraft {
  id: string;
  createdAt: string;
}

export interface ItemPage {
  items: Item[];
  nextCursor: string | null;
  total: number;
}
