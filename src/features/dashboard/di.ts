/**
 * Composition root for the Dashboard feature: binds the use case to the
 * concrete repository. Presentation imports from here only.
 */
import {dashboardRepository} from './data/dashboard.repository';
import {getDashboardSummaryUseCase} from './domain/usecases/getDashboardSummary';

export const dashboardUseCases = {
  getSummary: getDashboardSummaryUseCase(dashboardRepository),
};
