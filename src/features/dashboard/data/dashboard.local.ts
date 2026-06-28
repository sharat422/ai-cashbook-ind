import type {DashboardSummary} from '@features/dashboard/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {toISODate} from '@utils/date';

interface Dated {
  amount: number;
  date: string;
}

const sum = (items: Dated[]): number =>
  items.reduce((total, item) => total + (item.amount || 0), 0);

/**
 * Offline fallback: compute the dashboard summary from locally stored income and
 * expense entries (including optimistic/pending ones). Used when the backend is
 * unreachable so the dashboard still shows meaningful, on-device figures.
 */
export const dashboardLocal = {
  computeSummary(): DashboardSummary {
    const incomes = useIncomeStore.getState().entries;
    const expenses = useExpenseStore.getState().entries;

    const todayKey = toISODate(new Date());
    const monthKey = todayKey.slice(0, 7); // YYYY-MM

    const isToday = (e: Dated) => e.date === todayKey;
    const isThisMonth = (e: Dated) => e.date.slice(0, 7) === monthKey;

    const todayIncome = sum(incomes.filter(isToday));
    const todayExpense = sum(expenses.filter(isToday));
    const monthRevenue = sum(incomes.filter(isThisMonth));
    const monthExpense = sum(expenses.filter(isThisMonth));
    const cashBalance = sum(incomes) - sum(expenses);

    return {
      todayIncome,
      todayExpense,
      cashBalance,
      monthRevenue,
      monthExpense,
      asOf: new Date().toISOString(),
      source: 'local',
    };
  },
};
