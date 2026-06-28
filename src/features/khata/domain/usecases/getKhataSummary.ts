import type {KhataFilters, KhataSummary} from '../entities';
import type {KhataRepository} from '../repository';

/** Use case: fetch the khata dashboard summary for the given filters. */
export function getKhataSummaryUseCase(repo: KhataRepository) {
  return (filters: KhataFilters): Promise<KhataSummary> =>
    repo.getSummary(filters);
}
