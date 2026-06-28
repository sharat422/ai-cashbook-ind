/**
 * Composition root for the Categorization feature: binds use cases to the
 * concrete repository. Presentation imports from here only.
 */
import {categorizationRepository} from './data/categorization.repository';
import {categorizeExpenseUseCase} from './domain/usecases/categorizeExpense';

export const categorizationUseCases = {
  categorize: categorizeExpenseUseCase(categorizationRepository),
  correct: categorizationRepository.correct,
  getHistory: categorizationRepository.getHistory,
  clearHistory: categorizationRepository.clearHistory,
};
