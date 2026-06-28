/**
 * Composition root for the AI Khata Insights feature.
 */
import {insightsRepository} from './data/insight.repository';
import {getInsightsUseCase} from './domain/usecases/getInsights';

export const insightsUseCases = {
  getInsights: getInsightsUseCase(insightsRepository),
};
