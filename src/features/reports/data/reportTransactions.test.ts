jest.mock('@features/transactions/data/transaction.remote', () => ({
  transactionRemote: {getPage: jest.fn()},
}));

import {NetworkError} from '@api/client';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {transactionRemote} from '@features/transactions/data/transaction.remote';
import {getReportTransactions} from './reportTransactions';

const mockGetPage = transactionRemote.getPage as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useIncomeStore.setState({entries: [], queue: []});
  useExpenseStore.setState({entries: [], queue: []});
});

describe('getReportTransactions — online', () => {
  it('pages through the backend and flattens income/expense lines', async () => {
    mockGetPage
      .mockResolvedValueOnce({
        items: [
          {id: '1', type: 'income', amount: 4000, category: 'Sales', date: '2026-06-03', vendor: undefined, notes: 'inv 1', createdAt: ''},
        ],
        nextCursor: 'c1',
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          {id: '2', type: 'expense', amount: 1800, category: 'Fuel', date: '2026-06-10', vendor: 'HP Petrol', notes: undefined, createdAt: ''},
        ],
        nextCursor: null,
        total: 2,
      });

    const {items, source} = await getReportTransactions('2026-06-01', '2026-06-30');

    expect(mockGetPage).toHaveBeenCalledTimes(2); // followed the cursor
    expect(source).toBe('remote');
    expect(items).toEqual([
      {type: 'income', date: '2026-06-03', category: 'Sales', party: '', amount: 4000, notes: 'inv 1'},
      {type: 'expense', date: '2026-06-10', category: 'Fuel', party: 'HP Petrol', amount: 1800, notes: ''},
    ]);
  });
});

describe('getReportTransactions — offline fallback', () => {
  it('falls back to on-device entries (in range, sorted) on a NetworkError', async () => {
    mockGetPage.mockRejectedValue(new NetworkError('offline'));
    useIncomeStore.setState({
      entries: [
        {date: '2026-06-20', category: 'Sales', amount: 1000, notes: undefined} as never,
        {date: '2026-05-01', category: 'Sales', amount: 999, notes: undefined} as never, // out of range
      ],
    });
    useExpenseStore.setState({
      entries: [
        {date: '2026-06-05', category: 'Fuel', vendor: 'HP', amount: 500, notes: 'diesel'} as never,
      ],
    });

    const {items, source} = await getReportTransactions('2026-06-01', '2026-06-30');

    expect(source).toBe('local');
    // Out-of-range income excluded; remaining two sorted by date ascending.
    expect(items).toEqual([
      {type: 'expense', date: '2026-06-05', category: 'Fuel', party: 'HP', amount: 500, notes: 'diesel'},
      {type: 'income', date: '2026-06-20', category: 'Sales', party: '', amount: 1000, notes: ''},
    ]);
  });

  it('rethrows a non-network error (does not silently fall back)', async () => {
    mockGetPage.mockRejectedValue(new Error('500 server error'));
    await expect(
      getReportTransactions('2026-06-01', '2026-06-30'),
    ).rejects.toThrow('500 server error');
  });
});
