import type {DashboardSummary} from '../entities';
import type {DashboardRepository} from '../repository';

/** Use case: fetch the dashboard summary. */
export function getDashboardSummaryUseCase(repo: DashboardRepository) {
  return (signal?: AbortSignal): Promise<DashboardSummary> =>
    repo.getSummary(signal);
}
