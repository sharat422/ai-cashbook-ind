import {apiRequest} from '@api/client';
import type {Item, ItemDraft, ItemPage} from '@features/items/domain/entities';
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
  async list(search: string, limit = 50, cursor?: string): Promise<ItemPage> {
    const params = new URLSearchParams({limit: String(limit)});
    if (cursor) params.set('cursor', cursor);
    if (search.trim()) params.set('search', search.trim());
    const dto = await apiRequest<ItemPageDto>(`/items?${params.toString()}`, {
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
