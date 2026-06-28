import type {
  TransactionPage,
  TransactionQuery,
} from '@features/transactions/domain/entities';
import type {TransactionRepository} from '@features/transactions/domain/repository';
import {transactionRemote} from './transaction.remote';

/** Concrete repository backed by the FastAPI remote source. */
export const transactionRepository: TransactionRepository = {
  getPage(query: TransactionQuery): Promise<TransactionPage> {
    return transactionRemote.getPage(query);
  },
};
