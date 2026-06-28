import type {Insight} from './entities';

/** Repository contract for AI-generated khata insights. */
export interface InsightsRepository {
  getInsights(): Promise<Insight[]>;
}
