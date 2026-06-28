import type {
  InsightSentiment,
  InsightType,
} from '@features/insights/domain/entities';

export const TYPE_ICON: Record<InsightType, string> = {
  collection: '💸',
  risk: '⚠️',
  behavior: '⏱️',
  concentration: '🎯',
  general: '✨',
};

/** Sentiment colour tokens for the icon chip + metric pill. */
export const SENTIMENT_STYLE: Record<
  InsightSentiment,
  {chipBg: string; iconBg: string; metricText: string; bar: string}
> = {
  positive: {
    chipBg: 'bg-green-50',
    iconBg: 'bg-green-50',
    metricText: 'text-success',
    bar: 'bg-success',
  },
  neutral: {
    chipBg: 'bg-indigo-50',
    iconBg: 'bg-indigo-50',
    metricText: 'text-primary',
    bar: 'bg-primary',
  },
  warning: {
    chipBg: 'bg-amber-50',
    iconBg: 'bg-amber-50',
    metricText: 'text-amber-700',
    bar: 'bg-amber-500',
  },
  critical: {
    chipBg: 'bg-red-50',
    iconBg: 'bg-red-50',
    metricText: 'text-danger',
    bar: 'bg-danger',
  },
};
