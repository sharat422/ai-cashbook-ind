import {useInfiniteQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {ActivityIndicator, FlatList, Modal, Pressable, View} from 'react-native';

import {TextField} from '@components/form';
import {Text} from '@components/ui';
import {itemRemote} from '@features/items/data/item.remote';
import type {Item} from '@features/items/domain/entities';
import {useT} from '@/i18n';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';

export const ITEM_PAGE = 50;

/**
 * Pick a product from the catalogue, however large: the server searches it
 * (name in any script, or HSN) as you type, and the list loads 50 more as you
 * scroll. The whole catalogue is never loaded onto the phone.
 */
export function ItemPicker({label, placeholder, excludeIds = [], onPick, testID = 'item-picker'}: {
  label: string;
  placeholder: string;
  /** Already chosen: left out of the list. */
  excludeIds?: string[];
  onPick: (item: Item) => void;
  testID?: string;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q).trim();
  const pages = useInfiniteQuery({
    queryKey: ['items', 'picker', search],
    queryFn: ({pageParam}) => itemRemote.list(search, {limit: ITEM_PAGE, offset: pageParam, type: 'product'}),
    initialPageParam: 0,
    getNextPageParam: last => (last.nextCursor ? Number(last.nextCursor) : undefined),
    enabled: open,
  });
  const items = (pages.data?.pages ?? []).flatMap(p => p.items).filter(i => !excludeIds.includes(i.id));
  const more = () => {
    if (pages.hasNextPage && !pages.isFetchingNextPage) pages.fetchNextPage();
  };

  return (
    <View>
      <Text variant="label" className="mb-1.5">{label}</Text>
      <Pressable testID={testID} accessibilityRole="button" onPress={() => setOpen(true)}
        className="h-14 flex-row items-center justify-between rounded-xl border border-border bg-white px-4">
        <Text className="text-base text-muted">{placeholder}</Text>
        <Text className="text-muted">▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
          <Pressable className="h-[80%] rounded-t-3xl bg-white p-5">
            <Text variant="title" className="mb-3 text-lg">{label}</Text>
            <TextField testID={`${testID}-search`} value={q} onChangeText={setQ} autoFocus
              placeholder={t('items.searchPlaceholder')} accessibilityLabel={t('items.searchPlaceholder')} />
            <FlatList
              testID={`${testID}-list`}
              className="mt-3"
              data={items}
              keyExtractor={i => i.id}
              keyboardShouldPersistTaps="handled"
              onEndReached={more}
              onEndReachedThreshold={0.5}
              ItemSeparatorComponent={() => <View className="h-px bg-border" />}
              renderItem={({item}) => (
                <Pressable testID={`${testID}-item-${item.id}`} accessibilityRole="button" className="py-4"
                  onPress={() => {
                    onPick(item);
                    setOpen(false);
                  }}>
                  <Text className="text-base text-slate-900">{item.name}</Text>
                  {item.hsnSac ? <Text variant="caption">HSN {item.hsnSac}</Text> : null}
                </Pressable>
              )}
              ListEmptyComponent={pages.isFetching ? null : (
                <Text variant="caption" className="py-4">{search ? t('items.emptySearchTitle') : t('bill.noItems')}</Text>
              )}
              ListFooterComponent={pages.isFetching ? <ActivityIndicator className="py-4" /> : null}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
