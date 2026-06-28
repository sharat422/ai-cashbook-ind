import type {
  Customer,
  CustomerDraft,
  CustomerPage,
  CustomerQuery,
} from '@features/customers/domain/entities';
import type {CustomerRepository} from '@features/customers/domain/repository';
import {customerRemote} from './customer.remote';

/** Concrete repository backed by the FastAPI remote source. */
export const customerRepository: CustomerRepository = {
  list(query: CustomerQuery): Promise<CustomerPage> {
    return customerRemote.list(query);
  },
  getById(id: string): Promise<Customer> {
    return customerRemote.getById(id);
  },
  create(draft: CustomerDraft): Promise<Customer> {
    return customerRemote.create(draft);
  },
  update(id: string, draft: CustomerDraft): Promise<Customer> {
    return customerRemote.update(id, draft);
  },
  remove(id: string): Promise<void> {
    return customerRemote.remove(id);
  },
};
