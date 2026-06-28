import {useCallback, useMemo, useState} from 'react';

import {
  activeFilterCount,
  defaultFilters,
  type SortField,
  type TransactionFilters,
  type TransactionSort,
  type TransactionType,
} from '@features/transactions/domain/entities';

/**
 * Owns the history filter state and the operations the UI needs. Search is kept
 * here too so the screen has a single source of truth; the screen debounces it
 * before building the query.
 */
export function useTransactionFilters() {
  const [filters, setFilters] = useState<TransactionFilters>(defaultFilters);

  const setSearch = useCallback((search: string) => {
    setFilters(prev => ({...prev, search}));
  }, []);

  const setType = useCallback((type: TransactionType | 'all') => {
    setFilters(prev => ({...prev, type}));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setFilters(prev => {
      const has = prev.categories.includes(category);
      return {
        ...prev,
        categories: has
          ? prev.categories.filter(c => c !== category)
          : [...prev.categories, category],
      };
    });
  }, []);

  const setDateRange = useCallback(
    (range: {from: string | null; to: string | null}) => {
      setFilters(prev => ({...prev, dateFrom: range.from, dateTo: range.to}));
    },
    [],
  );

  const setSort = useCallback((sort: TransactionSort) => {
    setFilters(prev => ({...prev, sort}));
  }, []);

  const setSortByKey = useCallback(
    (field: SortField, direction: TransactionSort['direction']) => {
      setFilters(prev => ({...prev, sort: {field, direction}}));
    },
    [],
  );

  /** Reset everything except the search box (kept for continuity). */
  const clearFilters = useCallback(() => {
    setFilters(prev => ({...defaultFilters(), search: prev.search}));
  }, []);

  const activeCount = useMemo(() => activeFilterCount(filters), [filters]);

  return {
    filters,
    setSearch,
    setType,
    toggleCategory,
    setDateRange,
    setSort,
    setSortByKey,
    clearFilters,
    activeCount,
  };
}
