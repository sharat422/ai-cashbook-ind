/**
 * Domain types for AI Khata Insights. Pure — no framework imports.
 */

export type InsightType =
  | 'collection'
  | 'risk'
  | 'behavior'
  | 'concentration'
  | 'general';

export type InsightSentiment = 'positive' | 'neutral' | 'warning' | 'critical';

/** Where tapping an insight takes the user (drill-down). */
export interface InsightDrill {
  target: 'khata' | 'customers' | 'none';
  /** For 'customers': pre-fill the list search (e.g. a customer name). */
  search?: string;
}

export interface Insight {
  id: string;
  type: InsightType;
  sentiment: InsightSentiment;
  /** The headline, e.g. "3 customers contribute 60% of pending dues." */
  title: string;
  /** Optional supporting line. */
  detail?: string;
  /** Optional highlight metric, e.g. "+12%", "25%", "8 days". */
  metric?: string;
  drill: InsightDrill;
}
