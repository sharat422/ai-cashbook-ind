import type {
  Customer,
  CustomerDraft,
  CustomerPage,
  CustomerQuery,
} from '@features/customers/domain/entities';
import type {CustomerRepository} from '@features/customers/domain/repository';
import {customerRemote} from './customer.remote';
import {NetworkError} from '@api/client';
import {usePendingLedgerStore} from '../presentation/store/pendingLedger.store';

/** Concrete repository backed by the FastAPI remote source. */
export const customerRepository: CustomerRepository = {
  async list(query: CustomerQuery): Promise<CustomerPage> {
    try {
      const page = await customerRemote.list(query);
      usePendingLedgerStore.getState().cacheCustomers(page.items);
      return page;
    } catch (error) {
      if (!(error instanceof NetworkError)) { throw error; }
      const search = query.search.toLowerCase();
      const rows = Object.values(usePendingLedgerStore.getState().customers)
        .filter(c => `${c.fullName} ${c.mobile} ${c.businessName ?? ''}`.toLowerCase().includes(search))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      const offset = Number(query.cursor ?? 0);
      return {items: rows.slice(offset, offset + query.limit), total: rows.length,
        nextCursor: offset + query.limit < rows.length ? String(offset + query.limit) : null};
    }
  },
  async getById(id: string): Promise<Customer> {
    try {
      const customer = await customerRemote.getById(id);
      usePendingLedgerStore.getState().cacheCustomers([customer]);
      return customer;
    } catch (error) {
      const cached = usePendingLedgerStore.getState().customers[id];
      if (!(error instanceof NetworkError) || !cached) { throw error; }
      return cached;
    }
  },
  create(draft: CustomerDraft): Promise<Customer> {
    return customerRemote.create(draft);
  },
  update(
    id: string,
    draft: CustomerDraft,
    expectedVersion?: number,
  ): Promise<Customer> {
    return customerRemote.update(id, draft, expectedVersion);
  },
  remove(id: string): Promise<void> {
    return customerRemote.remove(id);
  },
};
