import {isSummaryEmpty, type DashboardSummary} from './entities';

const base: DashboardSummary = {
  todayIncome: 0,
  todayExpense: 0,
  cashBalance: 0,
  monthRevenue: 0,
  monthExpense: 0,
  asOf: '2026-06-01T00:00:00.000Z',
  source: 'remote',
};

describe('isSummaryEmpty', () => {
  it('is true when every figure is zero', () => {
    expect(isSummaryEmpty(base)).toBe(true);
  });

  it('is false when any figure is non-zero', () => {
    expect(isSummaryEmpty({...base, monthRevenue: 1000})).toBe(false);
    expect(isSummaryEmpty({...base, cashBalance: -50})).toBe(false);
  });
});
