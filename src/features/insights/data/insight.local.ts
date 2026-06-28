import type {Insight} from '@features/insights/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {formatINR} from '@utils/currency';

const monthKey = (date: string): string => date.slice(0, 7);

function sumForMonth(
  entries: {amount: number; date: string}[],
  key: string,
): number {
  return entries
    .filter(e => monthKey(e.date) === key)
    .reduce((t, e) => t + (e.amount || 0), 0);
}

/**
 * Offline fallback: a couple of heuristic insights from on-device income/expense
 * data. The cross-customer insights (risk %, defaulter concentration, per-
 * customer behaviour) need the server's AI analysis, so they appear only online.
 */
export const insightsLocal = {
  compute(): Insight[] {
    const incomes = useIncomeStore.getState().entries;
    const expenses = useExpenseStore.getState().entries;

    const now = new Date();
    const thisKey = now.toISOString().slice(0, 7);
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastKey = last.toISOString().slice(0, 7);

    const insights: Insight[] = [];

    // Collections trend (this month vs last).
    const collectedThis = sumForMonth(incomes, thisKey);
    const collectedLast = sumForMonth(incomes, lastKey);
    if (collectedLast > 0) {
      const pct = Math.round(((collectedThis - collectedLast) / collectedLast) * 100);
      const up = pct >= 0;
      insights.push({
        id: 'loc-collections',
        type: 'collection',
        sentiment: up ? 'positive' : 'warning',
        title: `Collections ${up ? 'improved' : 'declined'} by ${Math.abs(pct)}% this month.`,
        detail: `${formatINR(collectedThis)} collected vs ${formatINR(collectedLast)} last month.`,
        metric: `${up ? '+' : '−'}${Math.abs(pct)}%`,
        drill: {target: 'khata'},
      });
    }

    // Top spending category this month.
    const monthExpenses = expenses.filter(e => monthKey(e.date) === thisKey);
    if (monthExpenses.length > 0) {
      const byCat = new Map<string, number>();
      for (const e of monthExpenses) {
        byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
      }
      const [cat, amt] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
      insights.push({
        id: 'loc-spend',
        type: 'general',
        sentiment: 'neutral',
        title: `Most spending went to ${cat} this month.`,
        detail: `${formatINR(amt)} spent on ${cat}.`,
        metric: formatINR(amt),
        drill: {target: 'khata'},
      });
    }

    if (insights.length === 0) {
      insights.push({
        id: 'loc-empty',
        type: 'general',
        sentiment: 'neutral',
        title: 'Record more transactions to unlock AI insights.',
        detail: 'Add a few credits and payments and check back.',
        drill: {target: 'none'},
      });
    }

    return insights;
  },
};
