import type {Insight} from '../entities';
import type {InsightsRepository} from '../repository';

/** Use case: fetch the AI-generated khata insights. */
export function getInsightsUseCase(repo: InsightsRepository) {
  return (): Promise<Insight[]> => repo.getInsights();
}
