import type {
  CategoryTotal,
  DailySummary,
} from '@features/daily-summary/domain/entities';

interface CategoryTotalDto {
  category: string;
  amount: number;
  share: number;
}

/** Backend response (snake_case). */
export interface DailySummaryDto {
  date: string;
  income: number;
  expense: number;
  profit: number;
  transaction_count: number;
  top_expense_categories: CategoryTotalDto[];
}

const n = (v: number | null | undefined): number => Number(v ?? 0);

export function toDailySummary(dto: DailySummaryDto): DailySummary {
  const categories: CategoryTotal[] = (dto.top_expense_categories ?? []).map(
    c => ({category: c.category, amount: n(c.amount), share: n(c.share)}),
  );
  return {
    date: dto.date,
    income: n(dto.income),
    expense: n(dto.expense),
    profit: n(dto.profit),
    transactionCount: n(dto.transaction_count),
    topExpenseCategories: categories,
    source: 'remote',
  };
}
