import type {
  CategoryAmount,
  ReportSummary,
} from '@features/reports/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';

interface Entry {
  amount: number;
  category: string;
  date: string;
}

function byCategory(entries: Entry[], total: number): CategoryAmount[] {
  const buckets = new Map<string, number>();
  for (const e of entries) {
    buckets.set(e.category, (buckets.get(e.category) ?? 0) + (e.amount || 0));
  }
  return [...buckets.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      share: total ? amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Offline fallback: compute the report from locally-stored income/expense
 * entries (including pending ones) so reports work without the backend.
 */
export const reportLocal = {
  computeSummary(from: string, to: string): ReportSummary {
    const inRange = (e: Entry) => e.date >= from && e.date <= to;
    const incomes = (useIncomeStore.getState().entries as Entry[]).filter(inRange);
    const expenses = (useExpenseStore.getState().entries as Entry[]).filter(inRange);

    const incomeTotal = incomes.reduce((s, e) => s + (e.amount || 0), 0);
    const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    return {
      from,
      to,
      incomeTotal,
      expenseTotal,
      profit: incomeTotal - expenseTotal,
      incomeCount: incomes.length,
      expenseCount: expenses.length,
      incomeByCategory: byCategory(incomes, incomeTotal),
      expenseByCategory: byCategory(expenses, expenseTotal),
      source: 'local',
    };
  },
};
