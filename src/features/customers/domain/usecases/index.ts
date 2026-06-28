import type {Customer, CustomerDraft, CustomerPage, CustomerQuery} from '../entities';
import type {CustomerRepository} from '../repository';
import {validateCustomerDraft} from '../validation';

/** Throw a field-aware error when a draft is invalid. */
function assertValid(draft: CustomerDraft): void {
  const errors = validateCustomerDraft(draft);
  if (Object.keys(errors).length > 0) {
    const err = new Error('Please fix the highlighted fields.');
    (err as Error & {fields?: unknown}).fields = errors;
    throw err;
  }
}

function normalize(draft: CustomerDraft): CustomerDraft {
  return {
    fullName: draft.fullName.trim(),
    mobile: draft.mobile.trim(),
    gstNumber: draft.gstNumber?.trim().toUpperCase() || undefined,
    businessName: draft.businessName?.trim() || undefined,
    address: draft.address?.trim() || undefined,
    notes: draft.notes?.trim() || undefined,
  };
}

/** Compose all customer use cases against a repository. */
export function makeCustomerUseCases(repo: CustomerRepository) {
  return {
    list: (query: CustomerQuery, signal?: AbortSignal): Promise<CustomerPage> =>
      repo.list(query, signal),

    get: (id: string): Promise<Customer> => repo.getById(id),

    create: (draft: CustomerDraft): Promise<Customer> => {
      assertValid(draft);
      return repo.create(normalize(draft));
    },

    update: (id: string, draft: CustomerDraft): Promise<Customer> => {
      assertValid(draft);
      return repo.update(id, normalize(draft));
    },

    remove: (id: string): Promise<void> => repo.remove(id),
  };
}
