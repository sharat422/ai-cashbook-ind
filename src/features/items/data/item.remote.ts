import {apiRequest} from '@api/client';
import type {Item, ItemDraft, ItemPage} from '@features/items/domain/entities';
import {toQueryString} from '@utils/query';
import {
  fromItemDraft,
  toItem,
  toItemPage,
  type ItemDto,
  type ItemPageDto,
} from './item.dto';

/**
 * Remote data source — FastAPI item catalog CRUD.
 *
 *   GET/POST /api/v1/items ; GET/PATCH/DELETE /api/v1/items/{id}
 */
export const itemRemote = {
  /** One page of the catalogue (never all of it): `q` searches name and HSN
   *  on the server; the next page starts at `offset` (the page's nextCursor). */
  async list(q: string, {limit = 50, offset = 0, type}: {limit?: number; offset?: number; type?: 'product' | 'service'} = {}): Promise<ItemPage> {
    const qs = toQueryString({limit, offset, q: q.trim(), type});
    const dto = await apiRequest<ItemPageDto>(`/items?${qs}`, {
      method: 'GET',
    });
    return toItemPage(dto);
  },

  async create(draft: ItemDraft): Promise<Item> {
    const dto = await apiRequest<ItemDto>('/items', {
      method: 'POST',
      body: fromItemDraft(draft),
    });
    return toItem(dto);
  },

  async update(id: string, draft: ItemDraft): Promise<Item> {
    const dto = await apiRequest<ItemDto>(`/items/${id}`, {
      method: 'PATCH',
      body: fromItemDraft(draft),
    });
    return toItem(dto);
  },

  async remove(id: string): Promise<void> {
    await apiRequest<null>(`/items/${id}`, {method: 'DELETE'});
  },
};
