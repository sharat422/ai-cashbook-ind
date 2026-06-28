import type {DailySummary} from '../entities';
import type {DailySummaryRepository} from '../repository';

/** Use case: generate the daily summary for a given ISO date. */
export function getDailySummaryUseCase(repo: DailySummaryRepository) {
  return (date: string): Promise<DailySummary> => repo.getForDate(date);
}
