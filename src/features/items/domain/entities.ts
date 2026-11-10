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
/** GST 2.0 slabs (from 22 Sep 2025); 12% and 28% have ended. */
export const GST_RATES = [0, 5, 18, 40] as const;

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
  /** Opening stock when creating (goes into the godown). After that the
   *  server keeps it as the total of godown + vans; the item form can't set it. */
  stockQty: number;
  /** Low-stock alert below this total; null = no alert. */
  lowStockThreshold?: number | null;
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
