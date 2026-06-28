import {useInfiniteQuery} from '@tanstack/react-query';
import {useMemo} from 'react';

import {ENV} from '@config/env';
import {transactionUseCases} from '@features/transactions/di';
import type {
  Transaction,
  TransactionFilters,
  TransactionPage,
} from '@features/transactions/domain/entities';

/**
 * Infinite-scrolling transactions query.
 *
 * The page param is the opaque cursor (null for the first page). `queryKey`
 * embeds the filters, so any filter/search/sort change yields a fresh,
 * separately-cached infinite list — switching back is instant.
 *
 * Tuned for large datasets / low-end devices: 1 retry, 30s staleTime, and only
 * the loaded pages are ever held in memory (server-side pagination), so this
 * scales to 100k+ records without growing client memory unbounded.
 */
export function useTransactions(filters: TransactionFilters) {
  const limit = ENV.transactionsPageSize;

  const query = useInfiniteQuery<TransactionPage, Error>({
    queryKey: ['transactions', filters, limit],
    queryFn: ({pageParam, signal}) =>
      transactionUseCases.getPage(
        {...filters, cursor: (pageParam as string | null) ?? null, limit},
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.nextCursor,
    staleTime: 30_000,
    retry: 1,
  });

  /** Flattened list across loaded pages — what the FlatList renders. */
  const items = useMemo<Transaction[]>(
    () => query.data?.pages.flatMap(page => page.items) ?? [],
    [query.data],
  );

  const total = query.data?.pages[0]?.total ?? 0;

  return {...query, items, total};
}
