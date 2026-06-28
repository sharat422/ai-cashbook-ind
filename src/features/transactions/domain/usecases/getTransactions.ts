import type {TransactionPage, TransactionQuery} from '../entities';
import type {TransactionRepository} from '../repository';

/** Use case: fetch one page of transactions for the given query. */
export function getTransactionsUseCase(repo: TransactionRepository) {
  return (query: TransactionQuery, signal?: AbortSignal): Promise<TransactionPage> =>
    repo.getPage(query, signal);
}
