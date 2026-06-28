/**
 * Composition root for the Expense feature: binds domain use cases to the
 * concrete data-layer repository. Presentation imports from here only, staying
 * unaware of the data sources behind the interface.
 */
import {expenseRepository} from './data/expense.repository';
import {createExpenseUseCase} from './domain/usecases/createExpense';
import {syncPendingExpensesUseCase} from './domain/usecases/syncPendingExpenses';

export const expenseUseCases = {
  create: createExpenseUseCase(expenseRepository),
  syncPending: syncPendingExpensesUseCase(expenseRepository),
};
