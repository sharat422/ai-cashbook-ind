import type {Expense} from '@features/expense/domain/entities';
import type {Income} from '@features/income/domain/entities';

jest.mock('@features/income/data/income.remote', () => ({
  incomeRemote: {list: jest.fn()},
}));
jest.mock('@features/expense/data/expense.remote', () => ({
  expenseRemote: {list: jest.fn()},
}));

import {expenseRemote} from '@features/expense/data/expense.remote';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {incomeRemote} from '@features/income/data/income.remote';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {runRestore} from './runRestore';

const listIncome = incomeRemote.list as jest.Mock;
const listExpense = expenseRemote.list as jest.Mock;

const income = (id: string, createdAt: string): Income => ({
  id,
  amount: 100,
  category: 'Sales',
  date: '2026-01-01',
  attachment: null,
  createdAt,
  syncStatus: 'synced',
});

const expense = (id: string, createdAt: string): Expense => ({
  id,
  amount: 50,
  category: 'Fuel',
  date: '2026-01-01',
  vendor: 'HP',
  attachment: null,
  createdAt,
  syncStatus: 'synced',
});

describe('runRestore — fresh install + login', () => {
  beforeEach(() => {
    // Simulate a brand-new device: local stores start empty.
    useIncomeStore.setState({entries: [], queue: [], lastSyncedAt: null});
    useExpenseStore.setState({entries: [], queue: [], lastSyncedAt: null});
    listIncome.mockReset();
    listExpense.mockReset();
  });

  it('pulls the account’s cloud data into the empty local stores', async () => {
    listIncome.mockResolvedValue([
      income('i1', '2026-01-02T00:00:00Z'),
      income('i2', '2026-01-03T00:00:00Z'),
    ]);
    listExpense.mockResolvedValue([expense('e1', '2026-01-04T00:00:00Z')]);

    const progress: number[] = [];
    await runRestore({onProgress: p => progress.push(p.completed)});

    const incomes = useIncomeStore.getState().entries;
    const expenses = useExpenseStore.getState().entries;
    expect(incomes.map(e => e.id).sort()).toEqual(['i1', 'i2']);
    expect(expenses.map(e => e.id)).toEqual(['e1']);
    // lastSyncedAt is stamped so the app knows a restore happened.
    expect(useIncomeStore.getState().lastSyncedAt).not.toBeNull();
    // Progress advances from 0 to the final total.
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(2);
  });

  it('keeps a local pending draft that the server doesn’t know about', async () => {
    const pending: Income = {...income('local-1', '2026-01-05T00:00:00Z'), syncStatus: 'pending'};
    useIncomeStore.setState({entries: [pending]});
    listIncome.mockResolvedValue([income('i1', '2026-01-02T00:00:00Z')]);
    listExpense.mockResolvedValue([]);

    await runRestore();

    const ids = useIncomeStore.getState().entries.map(e => e.id).sort();
    expect(ids).toEqual(['i1', 'local-1']); // server entry + preserved local draft
  });

  it('rejects when a critical pull fails, so the UI can show an error + retry', async () => {
    listIncome.mockRejectedValue(new Error('network'));
    listExpense.mockResolvedValue([]);

    await expect(runRestore()).rejects.toThrow('network');
    // The store is left untouched rather than half-populated.
    expect(useIncomeStore.getState().entries).toEqual([]);
  });
});
