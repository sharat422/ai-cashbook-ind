import {apiRequest} from '@api/client';

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}
export interface Aging {
  buckets: AgingBuckets;
  total: number;
}

export interface CustomerRow {
  customerId: string;
  name: string;
  outstanding: number;
  daysOverdue: number;
}
export interface PaidRow {
  customerId: string;
  name: string;
  amount: number;
}
export interface DormantRow extends CustomerRow {
  daysSince: number;
}
export interface RiskRow extends CustomerRow {
  score: number;
}

export interface CustomerInsights {
  totalReceivable: number;
  overdueCount: number;
  topDebtors: CustomerRow[];
  overdue: CustomerRow[];
  paidThisMonth: PaidRow[];
  dormant: DormantRow[];
  highRisk: RiskRow[];
}

const toRow = (r: any): CustomerRow => ({
  customerId: r.customer_id,
  name: r.name,
  outstanding: Number(r.outstanding ?? 0),
  daysOverdue: Number(r.days_overdue ?? 0),
});

export const customerIntelRemote = {
  async aging(): Promise<Aging> {
    const dto = await apiRequest<any>('/customer-aging', {method: 'GET'});
    const b = dto.buckets ?? {};
    return {
      buckets: {
        current: Number(b.current ?? 0),
        d1_30: Number(b.d1_30 ?? 0),
        d31_60: Number(b.d31_60 ?? 0),
        d61_90: Number(b.d61_90 ?? 0),
        d90_plus: Number(b.d90_plus ?? 0),
      },
      total: Number(dto.total ?? 0),
    };
  },

  async insights(): Promise<CustomerInsights> {
    const d = await apiRequest<any>('/customer-insights', {method: 'GET'});
    return {
      totalReceivable: Number(d.total_receivable ?? 0),
      overdueCount: Number(d.overdue_count ?? 0),
      topDebtors: (d.top_debtors ?? []).map(toRow),
      overdue: (d.overdue ?? []).map(toRow),
      paidThisMonth: (d.paid_this_month ?? []).map((r: any) => ({
        customerId: r.customer_id,
        name: r.name,
        amount: Number(r.amount ?? 0),
      })),
      dormant: (d.dormant ?? []).map((r: any) => ({
        ...toRow(r),
        daysSince: Number(r.days_since ?? 0),
      })),
      highRisk: (d.high_risk ?? []).map((r: any) => ({
        ...toRow(r),
        score: Number(r.score ?? 0),
      })),
    };
  },
};
