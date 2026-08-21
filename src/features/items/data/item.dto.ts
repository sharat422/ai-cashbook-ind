import type {
  Item,
  ItemDraft,
  ItemPage,
  ItemType,
} from '@features/items/domain/entities';

export interface ItemDto {
  id: string;
  name: string;
  type: string;
  sale_price: number;
  purchase_price: number;
  unit: string | null;
  hsn_sac: string | null;
  gst_rate: number;
  track_stock: boolean;
  stock_qty: number;
  created_at: string;
}

export interface ItemPageDto {
  items: ItemDto[];
  next_cursor: string | null;
  total: number;
}

export function toItem(dto: ItemDto): Item {
  return {
    id: dto.id,
    name: dto.name,
    type: (dto.type as ItemType) ?? 'product',
    salePrice: Number(dto.sale_price ?? 0),
    purchasePrice: Number(dto.purchase_price ?? 0),
    unit: dto.unit ?? undefined,
    hsnSac: dto.hsn_sac ?? undefined,
    gstRate: Number(dto.gst_rate ?? 0),
    trackStock: !!dto.track_stock,
    stockQty: Number(dto.stock_qty ?? 0),
    createdAt: dto.created_at,
  };
}

export function toItemPage(dto: ItemPageDto): ItemPage {
  return {
    items: (dto.items ?? []).map(toItem),
    nextCursor: dto.next_cursor ?? null,
    total: dto.total ?? 0,
  };
}

export function fromItemDraft(draft: ItemDraft): Record<string, unknown> {
  return {
    name: draft.name,
    type: draft.type,
    sale_price: draft.salePrice,
    purchase_price: draft.purchasePrice,
    unit: draft.unit ?? null,
    hsn_sac: draft.hsnSac ?? null,
    gst_rate: draft.gstRate,
    track_stock: draft.trackStock,
    stock_qty: draft.stockQty,
  };
}
