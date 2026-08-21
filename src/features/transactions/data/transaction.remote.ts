import {apiRequest} from '@api/client';
import type {
  TransactionPage,
  TransactionQuery,
} from '@features/transactions/domain/entities';
import {toQueryString} from '@utils/query';
import {toTransactionPage, type TransactionPageDto} from './transaction.dto';

/** Serialize a query into backend params, omitting empty/default values. */
function buildQueryString(query: TransactionQuery): string {
  return toQueryString({
    limit: query.limit,
    sort_by: query.sort.field,
    sort_dir: query.sort.direction,
    cursor: query.cursor,
    search: query.search.trim(),
    type: query.type !== 'all' ? query.type : undefined,
    categories:
      query.categories.length > 0 ? query.categories.join(',') : undefined,
    date_from: query.dateFrom,
    date_to: query.dateTo,
  });
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
