/**
 * Composition root for the Income feature: binds domain use cases to the
 * concrete data-layer repository. Presentation code imports from here only,
 * keeping screens/hooks unaware of the data sources behind the interface.
 */
import {incomeRepository} from './data/income.repository';
import {createIncomeUseCase} from './domain/usecases/createIncome';
import {syncPendingIncomesUseCase} from './domain/usecases/syncPendingIncomes';

export const incomeUseCases = {
  create: createIncomeUseCase(incomeRepository),
  syncPending: syncPendingIncomesUseCase(incomeRepository),
};
