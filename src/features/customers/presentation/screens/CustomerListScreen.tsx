import React, {useCallback} from 'react';
import {ActivityIndicator, FlatList, Pressable, RefreshControl, View} from 'react-native';

import {SearchBar} from '@components/filters';
import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {Customer} from '@features/customers/domain/entities';
import {
  CARD_HEIGHT,
  CustomerCard,
} from '@features/customers/presentation/components';
import {useCustomers} from '@features/customers/presentation/hooks';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';

/** Premium customer list: search, infinite scroll, and pull to refresh. */
export function CustomerListScreen({
  navigation,
  route,
}: AppScreenProps<'Customers'>): React.JSX.Element {
  const [search, setSearch] = React.useState(route.params?.search ?? '');
  const debounced = useDebouncedValue(search, 350);

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
  } = useCustomers(debounced);

  const renderItem = useCallback(
    ({item}: {item: Customer}) => (
      <CustomerCard
        customer={item}
        onPress={() => navigation.navigate('CustomerProfile', {customer: item})}
      />
    ),
    [navigation],
  );
  const keyExtractor = useCallback((item: Customer) => item.id, []);
  const getItemLayout = useCallback(
    (_: ArrayLike<Customer> | null | undefined, index: number) => ({
      length: CARD_HEIGHT,
      offset: CARD_HEIGHT * index,
      index,
    }),
    [],
  );
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const showSkeleton = isLoading && items.length === 0;
  const showError = isError && items.length === 0;
  const showEmpty = !isLoading && !isError && items.length === 0;
  const hasSearch = debounced.trim().length > 0;

  return (
    <Screen scroll={false} edges={['top']}>
      <View className="pb-3 pt-4">
        <View className="flex-row items-center justify-between">
          <Text variant="title">Customers</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('CustomerForm')}
            className="flex-row items-center rounded-full bg-primary px-4 py-2"
            style={{
              shadowColor: colors.primary,
              shadowOpacity: 0.3,
              shadowRadius: 8,
              shadowOffset: {width: 0, height: 4},
              elevation: 3,
            }}>
            <Text className="text-sm font-semibold text-white">+ Add</Text>
          </Pressable>
        </View>

        <View className="mt-4">
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, business or mobile"
          />
        </View>

        {!showSkeleton && !showError ? (
          <Text variant="caption" className="mt-3">
            {total.toLocaleString('en-IN')} customer{total === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>

      <View className="flex-1">
        {showSkeleton ? (
          <SkeletonList />
        ) : showError ? (
          <View className="flex-1 justify-center">
            <ErrorState
              message={error?.message ?? 'Could not load customers.'}
              onRetry={refetch}
              retrying={isRefetching}
            />
          </View>
        ) : showEmpty ? (
          <View className="flex-1 justify-center">
            <EmptyState
              icon={hasSearch ? '🔎' : '👥'}
              title={hasSearch ? 'No customers found' : 'No customers yet'}
              message={
                hasSearch
                  ? 'Try a different name or number.'
                  : 'Add your first customer to start tracking dues.'
              }
              actionLabel={hasSearch ? undefined : '+ Add customer'}
              onAction={
                hasSearch
                  ? undefined
                  : () => navigation.navigate('CustomerForm')
              }
            />
          </View>
        ) : (
          <FlatList
            className="flex-1"
            data={items}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={9}
            removeClippedSubviews
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
              ) : null
            }
          />
        )}
      </View>
    </Screen>
  );
}

function SkeletonList(): React.JSX.Element {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({length: 7}).map((_, i) => (
        <View key={i} style={{height: CARD_HEIGHT, paddingBottom: 12}}>
          <View className="flex-1 flex-row items-center rounded-2xl border border-border bg-white px-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <View className="ml-3 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-28" />
            </View>
            <Skeleton className="h-5 w-16" />
          </View>
        </View>
      ))}
    </View>
  );
}
