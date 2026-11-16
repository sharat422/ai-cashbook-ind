/**
 * Offline customer search (no server): matches the same way as the server —
 * every word, and a mobile typed as the app shows it ("+91 98765 43210").
 */
jest.mock('./customer.remote', () => ({customerRemote: {list: jest.fn()}}));

import {NetworkError} from '@api/client';
import type {Customer} from '@features/customers/domain/entities';
import {usePendingLedgerStore} from '../presentation/store/pendingLedger.store';
import {customerRemote} from './customer.remote';
import {customerRepository} from './customer.repository';

const c = (id: string, fullName: string, mobile: string, businessName?: string) =>
  ({id, fullName, mobile, businessName, outstandingAmount: 0, isOverdue: false, createdAt: 'x'}) as Customer;

test('offline search: words, business name and the mobile as shown', async () => {
  (customerRemote.list as jest.Mock).mockRejectedValue(new NetworkError('offline'));
  usePendingLedgerStore.getState().cacheCustomers([
    c('1', 'Ramesh Kumar', '9876543210', 'Sri Lakshmi Kirana'),
    c('2', 'Suresh Rao', '9123456789'),
  ]);
  const names = async (search: string) =>
    (await customerRepository.list({search, cursor: null, limit: 20})).items.map(x => x.fullName);

  for (const q of ['rames', 'Lakshmi', '98765', '+91 98765', '98765 43210', 'Ramesh Kirana', ' ramesh ']) {
    expect(await names(q)).toEqual(['Ramesh Kumar']);
  }
  expect(await names('zzzz')).toEqual([]);
  expect(await names('Ramesh Rao')).toEqual([]);
});
