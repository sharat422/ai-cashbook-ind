import type {
  Customer,
  CustomerDraft,
  CustomerPage,
  CustomerQuery,
} from './entities';

/**
 * Repository contract for customer CRUD + listing. Implemented by the data
 * layer against the backend. Server-side pagination + search keeps the list
 * scalable; mutations return the affected customer so caches can update.
 */
export interface CustomerRepository {
  list(query: CustomerQuery, signal?: AbortSignal): Promise<CustomerPage>;
  getById(id: string): Promise<Customer>;
  create(draft: CustomerDraft): Promise<Customer>;
  update(id: string, draft: CustomerDraft): Promise<Customer>;
  remove(id: string): Promise<void>;
}
