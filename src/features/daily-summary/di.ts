/**
 * Composition root for the Daily Summary feature.
 */
import {dailySummaryRepository} from './data/dailySummary.repository';
import {getDailySummaryUseCase} from './domain/usecases/getDailySummary';

export const dailySummaryUseCases = {
  getForDate: getDailySummaryUseCase(dailySummaryRepository),
};
