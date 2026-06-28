import {apiRequest} from '@api/client';
import type {
  TransactionPage,
  TransactionQuery,
} from '@features/transactions/domain/entities';
import {toTransactionPage, type TransactionPageDto} from './transaction.dto';

/** Serialize a query into backend params, omitting empty/default values. */
function buildQueryString(query: TransactionQuery): string {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  params.set('sort_by', query.sort.field);
  params.set('sort_dir', query.sort.direction);

  if (query.cursor) params.set('cursor', query.cursor);
  if (query.search.trim()) params.set('search', query.search.trim());
  if (query.type !== 'all') params.set('type', query.type);
  if (query.categories.length > 0) {
    params.set('categories', query.categories.join(','));
  }
  if (query.dateFrom) params.set('date_from', query.dateFrom);
  if (query.dateTo) params.set('date_to', query.dateTo);

  return params.toString();
}

/**
 * Remote data source — talks to the FastAPI backend.
 *
 *   GET /api/v1/transactions?limit&sort_by&sort_dir&cursor&search&type&categories&date_from&date_to
 *     200 -> TransactionPageDto  (cursor pagination)
 */
export const transactionRemote = {
  async getPage(query: TransactionQuery): Promise<TransactionPage> {
    const qs = buildQueryString(query);
    const dto = await apiRequest<TransactionPageDto>(`/transactions?${qs}`, {
      method: 'GET',
    });
    return toTransactionPage(dto);
  },
};
