import type {
  CategoryAmount,
  ReportSummary,
} from '@features/reports/domain/entities';

interface CategoryAmountDto {
  category: string;
  amount: number;
  share: number;
}

export interface ReportSummaryDto {
  from: string;
  to: string;
  income_total: number;
  expense_total: number;
  profit: number;
  income_count: number;
  expense_count: number;
  income_by_category: CategoryAmountDto[];
  expense_by_category: CategoryAmountDto[];
}

const cat = (c: CategoryAmountDto): CategoryAmount => ({
  category: c.category,
  amount: Number(c.amount ?? 0),
  share: Number(c.share ?? 0),
});

export function toReportSummary(dto: ReportSummaryDto): ReportSummary {
  return {
    from: dto.from,
    to: dto.to,
    incomeTotal: Number(dto.income_total ?? 0),
    expenseTotal: Number(dto.expense_total ?? 0),
    profit: Number(dto.profit ?? 0),
    incomeCount: dto.income_count ?? 0,
    expenseCount: dto.expense_count ?? 0,
    incomeByCategory: (dto.income_by_category ?? []).map(cat),
    expenseByCategory: (dto.expense_by_category ?? []).map(cat),
    source: 'remote',
  };
}
