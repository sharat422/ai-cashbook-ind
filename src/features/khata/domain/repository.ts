import type {KhataFilters, KhataSummary} from './entities';

/** Repository contract for the Khata dashboard summary. */
export interface KhataRepository {
  getSummary(filters: KhataFilters): Promise<KhataSummary>;
}
