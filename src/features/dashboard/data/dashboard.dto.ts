import type {DashboardSummary} from '@features/dashboard/domain/entities';

/** Shape returned by the FastAPI backend (snake_case). */
export interface DashboardSummaryDto {
  today_income: number;
  today_expense: number;
  cash_balance: number;
  month_revenue: number;
  month_expense: number;
  as_of: string;
}

/** Map a backend DTO to a domain entity, coercing nullish numbers to 0. */
export function toDashboardSummary(
  dto: DashboardSummaryDto,
): DashboardSummary {
  const n = (v: number | null | undefined): number => Number(v ?? 0);
  return {
    todayIncome: n(dto.today_income),
    todayExpense: n(dto.today_expense),
    cashBalance: n(dto.cash_balance),
    monthRevenue: n(dto.month_revenue),
    monthExpense: n(dto.month_expense),
    asOf: dto.as_of ?? new Date().toISOString(),
    source: 'remote',
  };
}
