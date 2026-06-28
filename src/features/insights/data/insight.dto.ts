import type {
  Insight,
  InsightDrill,
  InsightSentiment,
  InsightType,
} from '@features/insights/domain/entities';

/** Single insight from the backend (snake_case). */
export interface InsightDto {
  id: string;
  type: string;
  sentiment: string;
  title: string;
  detail?: string | null;
  metric?: string | null;
  drill?: {target?: string; search?: string | null} | null;
}

const TYPES: InsightType[] = [
  'collection',
  'risk',
  'behavior',
  'concentration',
  'general',
];
const SENTIMENTS: InsightSentiment[] = [
  'positive',
  'neutral',
  'warning',
  'critical',
];

function toDrill(dto: InsightDto['drill']): InsightDrill {
  const target = dto?.target;
  if (target === 'khata') return {target: 'khata'};
  if (target === 'customers') {
    return {target: 'customers', search: dto?.search ?? undefined};
  }
  return {target: 'none'};
}

export function toInsight(dto: InsightDto): Insight {
  return {
    id: dto.id,
    type: TYPES.includes(dto.type as InsightType)
      ? (dto.type as InsightType)
      : 'general',
    sentiment: SENTIMENTS.includes(dto.sentiment as InsightSentiment)
      ? (dto.sentiment as InsightSentiment)
      : 'neutral',
    title: dto.title,
    detail: dto.detail ?? undefined,
    metric: dto.metric ?? undefined,
    drill: toDrill(dto.drill),
  };
}
