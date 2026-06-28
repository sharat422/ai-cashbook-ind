import type {TransactionPage, TransactionQuery} from './entities';

/**
 * Repository contract the domain depends on. Implemented by the data layer
 * (FastAPI). Server-side pagination + filtering + sorting is what makes
 * 100k+ records feasible — the client only ever holds the loaded pages.
 */
export interface TransactionRepository {
  getPage(query: TransactionQuery, signal?: AbortSignal): Promise<TransactionPage>;
}
