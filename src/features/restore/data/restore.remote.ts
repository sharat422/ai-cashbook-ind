import {apiRequest} from '@api/client';
import type {RestoreSummary} from '@features/restore/domain/entities';

interface RestoreSummaryDto {
  incomes: number;
  expenses: number;
  customers: number;
  ledger_entries: number;
  transactions: number;
  total: number;
}

/**
 * Remote data source for the restore flow.
 *   GET /api/v1/restore/summary -> counts of the account's cloud data
 */
export const restoreRemote = {
  async getSummary(): Promise<RestoreSummary> {
    const dto = await apiRequest<RestoreSummaryDto>('/restore/summary', {
      method: 'GET',
    });
    return {
      incomes: dto.incomes,
      expenses: dto.expenses,
      customers: dto.customers,
      ledgerEntries: dto.ledger_entries,
      transactions: dto.transactions,
      total: dto.total,
    };
  },
};
