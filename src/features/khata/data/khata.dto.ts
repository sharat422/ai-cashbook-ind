import type {
  KhataDefaulter,
  KhataSummary,
  TrendPoint,
} from '@features/khata/domain/entities';

export interface KhataSummaryDto {
  total_receivable: number;
  total_payable: number;
  overdue_amount: number;
  today_collections: number;
  top_defaulters: Array<{
    customer_id: string;
    name: string;
    amount: number;
    days_overdue: number;
  }>;
  trend: Array<{date: string; collected: number; billed: number}>;
}

const n = (v: number | null | undefined): number => Number(v ?? 0);

export function toKhataSummary(dto: KhataSummaryDto): KhataSummary {
  const defaulters: KhataDefaulter[] = (dto.top_defaulters ?? []).map(d => ({
    customerId: d.customer_id,
    name: d.name,
    amount: n(d.amount),
    daysOverdue: n(d.days_overdue),
  }));
  const trend: TrendPoint[] = (dto.trend ?? []).map(p => ({
    date: p.date,
    collected: n(p.collected),
    billed: n(p.billed),
  }));
  return {
    totalReceivable: n(dto.total_receivable),
    totalPayable: n(dto.total_payable),
    overdueAmount: n(dto.overdue_amount),
    todayCollections: n(dto.today_collections),
    topDefaulters: defaulters,
    trend,
    source: 'remote',
  };
}
