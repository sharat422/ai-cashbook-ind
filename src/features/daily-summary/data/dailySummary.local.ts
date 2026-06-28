import type {
  CategoryTotal,
  DailySummary,
} from '@features/daily-summary/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';

const sum = (items: {amount: number}[]): number =>
  items.reduce((total, i) => total + (i.amount || 0), 0);

/** Top N expense categories for a day, with each category's share of spend. */
function topCategories(
  expenses: {amount: number; category: string}[],
  total: number,
  limit = 5,
): CategoryTotal[] {
  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  }
  return Array.from(byCategory.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      share: total > 0 ? amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/**
 * Offline fallback: compute the daily summary on-device from stored income and
 * expense entries (including optimistic/pending ones). Lets the engine run with
 * no backend and keeps the daily notification working offline.
 */
export const dailySummaryLocal = {
  computeForDate(date: string): DailySummary {
    const incomes = useIncomeStore
      .getState()
      .entries.filter(e => e.date === date);
    const expenses = useExpenseStore
      .getState()
      .entries.filter(e => e.date === date);

    const income = sum(incomes);
    const expense = sum(expenses);

    return {
      date,
      income,
      expense,
      profit: income - expense,
      transactionCount: incomes.length + expenses.length,
      topExpenseCategories: topCategories(expenses, expense),
      source: 'local',
    };
  },
};
