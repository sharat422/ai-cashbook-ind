import type {DashboardSummary} from './entities';

/**
 * Repository contract the domain depends on. The data layer implements it
 * (FastAPI). Use cases never import the concrete data source, only this.
 */
export interface DashboardRepository {
  /** Fetch the aggregated dashboard summary. Throws on network/HTTP failure. */
  getSummary(signal?: AbortSignal): Promise<DashboardSummary>;
}
