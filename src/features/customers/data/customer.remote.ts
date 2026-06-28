import {apiRequest} from '@api/client';
import type {
  Customer,
  CustomerDraft,
  CustomerPage,
  CustomerQuery,
} from '@features/customers/domain/entities';
import {
  fromCustomerDraft,
  toCustomer,
  toCustomerPage,
  type CustomerDto,
  type CustomerPageDto,
} from './customer.dto';

/**
 * Remote data source — FastAPI customer CRUD.
 *
 *   GET    /api/v1/customers?limit&cursor&search   -> CustomerPageDto
 *   GET    /api/v1/customers/{id}                  -> CustomerDto
 *   POST   /api/v1/customers                       -> CustomerDto
 *   PATCH  /api/v1/customers/{id}                  -> CustomerDto
 *   DELETE /api/v1/customers/{id}                  -> 204
 */
export const customerRemote = {
  async list(query: CustomerQuery): Promise<CustomerPage> {
    const params = new URLSearchParams({limit: String(query.limit)});
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.search.trim()) params.set('search', query.search.trim());
    const dto = await apiRequest<CustomerPageDto>(
      `/customers?${params.toString()}`,
      {method: 'GET'},
    );
    return toCustomerPage(dto);
  },

  async getById(id: string): Promise<Customer> {
    const dto = await apiRequest<CustomerDto>(`/customers/${id}`, {
      method: 'GET',
    });
    return toCustomer(dto);
  },

  async create(draft: CustomerDraft): Promise<Customer> {
    const dto = await apiRequest<CustomerDto>('/customers', {
      method: 'POST',
      body: fromCustomerDraft(draft),
    });
    return toCustomer(dto);
  },

  async update(id: string, draft: CustomerDraft): Promise<Customer> {
    const dto = await apiRequest<CustomerDto>(`/customers/${id}`, {
      method: 'PATCH',
      body: fromCustomerDraft(draft),
    });
    return toCustomer(dto);
  },

  async remove(id: string): Promise<void> {
    await apiRequest<null>(`/customers/${id}`, {method: 'DELETE'});
  },
};
