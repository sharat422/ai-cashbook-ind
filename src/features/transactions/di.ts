/**
 * Composition root for the Transactions feature: binds the use case to the
 * concrete repository. Presentation imports from here only.
 */
import {transactionRepository} from './data/transaction.repository';
import {getTransactionsUseCase} from './domain/usecases/getTransactions';

export const transactionUseCases = {
  getPage: getTransactionsUseCase(transactionRepository),
};
