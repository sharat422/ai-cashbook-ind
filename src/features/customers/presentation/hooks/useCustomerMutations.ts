import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/react-query';

import {customerUseCases} from '@features/customers/di';
import type {
  Customer,
  CustomerDraft,
  CustomerPage,
} from '@features/customers/domain/entities';
import {CUSTOMERS_KEY} from './useCustomers';

type ListData = InfiniteData<CustomerPage>;
/** Snapshot of every list query we touched, for rollback on error. */
type Ctx = {previous: Array<[QueryKey, ListData | undefined]>};

const LIST_FILTER = {queryKey: [CUSTOMERS_KEY, 'list']} as const;

/** Convert form fields into the optimistic Customer field overrides. */
function draftFields(draft: CustomerDraft): Partial<Customer> {
  return {
    fullName: draft.fullName.trim(),
    mobile: draft.mobile.trim(),
    gstNumber: draft.gstNumber?.trim() || undefined,
    businessName: draft.businessName?.trim() || undefined,
    address: draft.address?.trim() || undefined,
    notes: draft.notes?.trim() || undefined,
  };
}

/** Build a placeholder customer to show instantly while the create is in flight. */
function optimisticCustomer(draft: CustomerDraft): Customer {
  return {
    id: `tmp_${Date.now()}`,
    outstandingAmount: 0,
    lastTransactionDate: null,
    isOverdue: false,
    createdAt: new Date().toISOString(),
    ...draftFields(draft),
  } as Customer;
}

/**
 * Create / update / delete with **optimistic updates**: the list reflects the
 * change immediately by patching the cached infinite query, rolls back on
 * error, and reconciles with the server `onSettled`.
 */
export function useCustomerMutations() {
  const queryClient = useQueryClient();

  /** Snapshot + cancel in-flight refetches before an optimistic patch. */
  async function begin(): Promise<Ctx> {
    await queryClient.cancelQueries({queryKey: [CUSTOMERS_KEY]});
    return {previous: queryClient.getQueriesData<ListData>(LIST_FILTER)};
  }

  function patch(updater: (data: ListData) => ListData): void {
    queryClient.setQueriesData<ListData>(
      LIST_FILTER,
      (old: ListData | undefined) => (old ? updater(old) : old),
    );
  }

  function rollback(ctx?: Ctx): void {
    ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
  }

  const settle = () =>
    queryClient.invalidateQueries({queryKey: [CUSTOMERS_KEY]});

  const create = useMutation<Customer, Error, CustomerDraft, Ctx>({
    mutationFn: draft => customerUseCases.create(draft),
    onMutate: async draft => {
      const ctx = await begin();
      const optimistic = optimisticCustomer(draft);
      patch(old => ({
        ...old,
        pages: old.pages.map((page, i) => ({
          ...page,
          total: page.total + 1,
          items: i === 0 ? [optimistic, ...page.items] : page.items,
        })),
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: settle,
  });

  const update = useMutation<
    Customer,
    Error,
    {id: string; draft: CustomerDraft},
    Ctx
  >({
    mutationFn: ({id, draft}) => customerUseCases.update(id, draft),
    onMutate: async ({id, draft}) => {
      const ctx = await begin();
      const fields = draftFields(draft);
      patch(old => ({
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          items: page.items.map(c => (c.id === id ? {...c, ...fields} : c)),
        })),
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: settle,
  });

  const remove = useMutation<void, Error, string, Ctx>({
    mutationFn: id => customerUseCases.remove(id),
    onMutate: async id => {
      const ctx = await begin();
      patch(old => ({
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          total: Math.max(0, page.total - 1),
          items: page.items.filter(c => c.id !== id),
        })),
      }));
      return ctx;
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: settle,
  });

  return {create, update, remove};
}
