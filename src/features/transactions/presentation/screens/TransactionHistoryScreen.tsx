import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';

import {FilterChip, SearchBar} from '@components/filters';
import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {useT, type TKey} from '@/i18n';
import {categoryLabel} from '@/i18n/labels';
import type {Transaction} from '@features/transactions/domain/entities';
import {
  FilterSheet,
  ROW_HEIGHT,
  TransactionRow,
} from '@features/transactions/presentation/components';
import {
  useTransactionFilters,
  useTransactions,
} from '@features/transactions/presentation/hooks';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';
import {colors} from '@theme/colors';
import {formatDisplayDate} from '@utils/date';

const SORT_LABEL: Record<string, TKey> = {
  'date-desc': 'history.newestFirst',
  'date-asc': 'history.oldestFirst',
  'amount-desc': 'history.amountDown',
  'amount-asc': 'history.amountUp',
};

/**
 * Transaction History: infinite scroll, debounced search, filters (type,
 * category, date range), and sort. Built on a tuned FlatList that scales to
 * 100k+ records via server-side pagination + getItemLayout + windowing.
 */
export function TransactionHistoryScreen(): React.JSX.Element {
  const t = useT();
  const {
    filters,
    setSearch,
    setType,
    toggleCategory,
    setDateRange,
    setSortByKey,
    clearFilters,
    activeCount,
  } = useTransactionFilters();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Debounce only what the query sees; the input stays fully responsive.
  const debouncedSearch = useDebouncedValue(filters.search, 350);
  const effectiveFilters = useMemo(
    () => ({...filters, search: debouncedSearch}),
    [filters, debouncedSearch],
  );

  const {
    items,
    total,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTransactions(effectiveFilters);

  const sortKey = `${filters.sort.field}-${filters.sort.direction}`;

  const renderItem = useCallback(
    ({item}: {item: Transaction}) => <TransactionRow tx={item} />,
    [],
  );
  const keyExtractor = useCallback((item: Transaction) => item.id, []);
  const getItemLayout = useCallback(
    (_: ArrayLike<Transaction> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Removable summary chips for currently-active filters.
  const activeChips = useMemo(() => {
    const chips: Array<{key: string; label: string; onRemove: () => void}> = [];
    if (filters.type !== 'all') {
      chips.push({
        key: 'type',
        label: t(filters.type === 'income' ? 'txn.typeIncome' : 'txn.typeExpense'),
        onRemove: () => setType('all'),
      });
    }
    filters.categories.forEach(category =>
      chips.push({
        key: `cat-${category}`,
        label: categoryLabel(t, category),
        onRemove: () => toggleCategory(category),
      }),
    );
    if (filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom ? formatDisplayDate(filters.dateFrom) : '…';
      const to = filters.dateTo ? formatDisplayDate(filters.dateTo) : '…';
      chips.push({
        key: 'date',
        label: `${from} – ${to}`,
        onRemove: () => setDateRange({from: null, to: null}),
      });
    }
    return chips;
  }, [filters, setType, toggleCategory, setDateRange, t]);

  const showSkeleton = isLoading && items.length === 0;
  const showError = isError && items.length === 0;
  const showEmpty = !isLoading && !isError && items.length === 0;
  const hasActiveQuery = activeCount > 0 || debouncedSearch.trim().length > 0;

  return (
    <Screen scroll={false} edges={['top']}>
      <View className="pb-3 pt-4">
        <Text variant="title">{t('history.title')}</Text>

        <View className="mt-4">
          <SearchBar
            value={filters.search}
            onChangeText={setSearch}
            placeholder={t('history.searchPlaceholder')}
          />
        </View>

        {/* Filters + sort controls */}
        <View className="mt-3 flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            onPress={() => setSheetOpen(true)}
            className="flex-row items-center rounded-xl border border-border bg-white px-3 py-2">
            <Text className="text-sm font-semibold text-slate-800">
              {t('history.filters')}
            </Text>
            {activeCount > 0 ? (
              <View className="ml-2 h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5">
                <Text className="text-xs font-bold text-white">
                  {activeCount}
                </Text>
              </View>
            ) : null}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setSheetOpen(true)}
            className="flex-row items-center">
            <Text variant="caption">{t('history.sortLabel')} </Text>
            <Text className="text-sm font-semibold text-primary">
              {t(SORT_LABEL[sortKey] ?? 'history.newestFirst')}
            </Text>
          </Pressable>
        </View>

        {/* Active filter chips */}
        {activeChips.length > 0 ? (
          <View className="mt-3 flex-row flex-wrap" style={{gap: 8}}>
            {activeChips.map(chip => (
              <FilterChip
                key={chip.key}
                label={chip.label}
                selected
                removable
                onPress={chip.onRemove}
              />
            ))}
          </View>
        ) : null}

        {/* Results count */}
        {!showSkeleton && !showError ? (
          <Text variant="caption" className="mt-3">
            {total === 1 ? t('history.oneResult') : t('history.results', {count: total.toLocaleString('en-IN')})}
          </Text>
        ) : null}
      </View>

      <View className="flex-1">
      {showSkeleton ? (
        <SkeletonList />
      ) : showError ? (
        <View className="flex-1 justify-center">
          <ErrorState
            message={error?.message ?? t('history.loadError')}
            onRetry={refetch}
            retrying={isRefetching}
          />
        </View>
      ) : showEmpty ? (
        <View className="flex-1 justify-center">
          <EmptyState
            icon="🔎"
            title={t('history.empty')}
            message={
              hasActiveQuery
                ? t('history.emptyFiltered')
                : t('history.emptyNone')
            }
            actionLabel={hasActiveQuery ? t('history.clearFilters') : undefined}
            onAction={hasActiveQuery ? clearFilters : undefined}
          />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          // --- Large-list performance tuning ---
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={9}
          removeClippedSubviews
          // --- Infinite scroll ---
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{paddingBottom: 24}}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-4">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : !hasNextPage && items.length > 0 ? (
              <Text variant="caption" className="py-4 text-center">
                {t('history.end')}
              </Text>
            ) : null
          }
        />
      )}
      </View>

      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        onSetType={setType}
        onToggleCategory={toggleCategory}
        onSetDateRange={setDateRange}
        onSetSort={setSortByKey}
        onClear={clearFilters}
      />
    </Screen>
  );
}

/** Static skeleton list shown on first load. */
function SkeletonList(): React.JSX.Element {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({length: 8}).map((_, i) => (
        <View key={i} style={{height: ROW_HEIGHT, paddingBottom: 8}}>
          <View className="flex-1 flex-row items-center rounded-xl border border-border bg-white px-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <View className="ml-3 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-24" />
            </View>
            <Skeleton className="h-4 w-16" />
          </View>
        </View>
      ))}
    </View>
  );
}
