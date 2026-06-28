import type {DailySummary} from './entities';

/**
 * Repository contract. The data layer fetches the summary from the backend and
 * falls back to computing it on-device from stored entries.
 */
export interface DailySummaryRepository {
  /** Generate the summary for an ISO date (YYYY-MM-DD). */
  getForDate(date: string): Promise<DailySummary>;
}
