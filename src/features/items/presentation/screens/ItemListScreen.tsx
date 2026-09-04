import React, {useState} from 'react';
import {FlatList, Pressable, RefreshControl, View} from 'react-native';

import {SearchBar} from '@components/filters';
import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {Item} from '@features/items/domain/entities';
import {useItems} from '@features/items/presentation/hooks/useItems';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

export function ItemListScreen({
  navigation,
}: AppScreenProps<'Items'>): React.JSX.Element {
  const t = useT();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 350);
  const {data, isLoading, isError, error, refetch, isRefetching} =
    useItems(debounced);

  const items = data?.items ?? [];
  const showSkeleton = isLoading && items.length === 0;
  const showError = isError && items.length === 0;
  const showEmpty = !isLoading && !isError && items.length === 0;
  const hasSearch = debounced.trim().length > 0;

  return (
    <Screen scroll={false} edges={['top']}>
      <View className="pb-3 pt-4">
        <View className="flex-row items-center justify-between">
          <Text variant="title">{t('items.title')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('ItemForm')}
            className="rounded-full bg-primary px-4 py-2">
            <Text className="text-sm font-semibold text-white">
              {t('items.add')}
            </Text>
          </Pressable>
        </View>
        <View className="mt-4">
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder={t('items.searchPlaceholder')}
          />
        </View>
        {!showSkeleton && !showError ? (
          <Text variant="caption" className="mt-3">
            {(data?.total ?? 0) === 1
              ? t('items.countOne')
              : t('items.count', {
                  count: (data?.total ?? 0).toLocaleString('en-IN'),
                })}
          </Text>
        ) : null}
      </View>

      <View className="flex-1">
        {showSkeleton ? (
          <View style={{gap: 12}}>
            {Array.from({length: 6}).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </View>
        ) : showError ? (
          <View className="flex-1 justify-center">
            <ErrorState
              message={error?.message ?? t('items.loadError')}
              onRetry={refetch}
              retrying={isRefetching}
            />
          </View>
        ) : showEmpty ? (
          <View className="flex-1 justify-center">
            <EmptyState
              icon={hasSearch ? '🔎' : '🏷️'}
              title={
                hasSearch ? t('items.emptySearchTitle') : t('items.emptyTitle')
              }
              message={
                hasSearch ? t('items.emptySearchMsg') : t('items.emptyMsg')
              }
              actionLabel={hasSearch ? undefined : t('items.addFirst')}
              onAction={hasSearch ? undefined : () => navigation.navigate('ItemForm')}
            />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={i => i.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{paddingBottom: 24, gap: 10}}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetch}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            renderItem={({item}) => (
              <ItemRow
                item={item}
                onPress={() => navigation.navigate('ItemForm', {item})}
              />
            )}
          />
        )}
      </View>
    </Screen>
  );
}

function ItemRow({
  item,
  onPress,
}: {
  item: Item;
  onPress: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between rounded-2xl border border-border bg-white px-4 py-3">
      <View className="flex-1 pr-3">
        <Text className="font-semibold text-slate-900" numberOfLines={1}>
          {item.name}
        </Text>
        <Text variant="caption" className="mt-0.5">
          {item.type === 'service' ? t('items.service') : t('items.product')}
          {item.hsnSac ? ` · HSN ${item.hsnSac}` : ''} · GST {item.gstRate}%
          {item.trackStock ? ` · ${t('items.stock')} ${item.stockQty}` : ''}
        </Text>
      </View>
      <Text className="text-base font-semibold text-slate-900">
        {formatINR(item.salePrice)}
      </Text>
    </Pressable>
  );
}
