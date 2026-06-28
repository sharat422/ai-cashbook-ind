import {useInfiniteQuery} from '@tanstack/react-query';
import {useMemo} from 'react';

import {customerUseCases} from '@features/customers/di';
import type {
  Customer,
  CustomerPage,
} from '@features/customers/domain/entities';

const PAGE_SIZE = 20;

export const CUSTOMERS_KEY = 'customers';

/**
 * Infinite, searchable customer list. `search` is part of the query key, so a
 * new search yields a fresh, separately-cached list. Only loaded pages are held
 * in memory (server-side pagination), so the list scales.
 */
export function useCustomers(search: string) {
  const query = useInfiniteQuery<CustomerPage, Error>({
    queryKey: [CUSTOMERS_KEY, 'list', search],
    queryFn: ({pageParam, signal}) =>
      customerUseCases.list(
        {search, cursor: (pageParam as string | null) ?? null, limit: PAGE_SIZE},
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.nextCursor,
    staleTime: 30_000,
    retry: 1,
  });

  const items = useMemo<Customer[]>(
    () => query.data?.pages.flatMap(p => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  return {...query, items, total};
}
