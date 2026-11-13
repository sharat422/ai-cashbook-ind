/** SC7 on the phone: an offline bill the server refused shows on the conflict
 *  screen with the reason, and on the retailer's ledger it waits with no amount. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {TransactionCard} from '@features/customers/presentation/components/TransactionCard';
import {useStockQueue} from '@features/stock/data/stockQueue';
import {StockConflictScreen} from './StockConflictScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const textOf = (r: ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id)[0].findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children).join(' ');

test('a bill whose scheme ended offline shows why on the conflict screen', () => {
  const reason = "Scheme 'Diwali 10+1' ended on 2026-11-10, after this bill was made offline.";
  useStockQueue.setState({pending: [], conflicts: [{
    entry: {op: 'bill', itemName: 'Ravi Stores', input: {clientId: 'b1', customerId: 'ravi', date: '2026-11-10',
      location: 'van', lines: [{itemId: 'soap', quantity: '20'}]}},
    queued: '', current: '', reason, detectedAt: '2026-11-11T09:00:00Z'}]});
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={new QueryClient()}>
        <StockConflictScreen navigation={{goBack: jest.fn()} as any} route={{params: {clientId: 'b1'}} as any} />
      </QueryClientProvider>,
    );
  });
  expect(textOf(r, 'conflict-reason')).toContain(reason);
  expect(r.root.findAll(n => n.props.testID === 'conflict-queued')).toEqual([]);  // no stock boxes for a bill
  act(() => r.unmount());
});

test('a queued bill shows on the ledger as waiting to sync, with no amount', () => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<TransactionCard entry={{id: 'b1', type: 'credit', amount: 0, date: '2026-11-10', createdAt: '',
      syncStatus: 'pending', queuedBillLines: 2, balance: 100}} />);
  });
  expect(textOf(r, 'bill-waiting')).toContain('waiting to sync');
  expect(JSON.stringify(r.toJSON())).not.toContain('₹0');
  act(() => r.unmount());
});
