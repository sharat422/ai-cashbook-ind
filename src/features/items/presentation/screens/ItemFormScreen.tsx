import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {AmountInput, FormField, TextField} from '@components/form';
import {Button, Screen, SegmentedControl, Select, Text} from '@components/ui';
import {
  GST_RATES,
  ITEM_UNITS,
  type ItemDraft,
  type ItemType,
} from '@features/items/domain/entities';
import {useItemMutations} from '@features/items/presentation/hooks/useItems';
import type {AppScreenProps} from '@navigation/types';

const TYPE_OPTIONS = [
  {label: 'Product', value: 'product' as ItemType},
  {label: 'Service', value: 'service' as ItemType},
];
const STOCK_OPTIONS = [
  {label: 'On', value: true},
  {label: 'Off', value: false},
];

export function ItemFormScreen({
  navigation,
  route,
}: AppScreenProps<'ItemForm'>): React.JSX.Element {
  const editing = route.params?.item;
  const {create, update, remove} = useItemMutations();

  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<ItemType>(editing?.type ?? 'product');
  const [salePrice, setSalePrice] = useState<number>(
    editing?.salePrice ?? NaN,
  );
  const [purchasePrice, setPurchasePrice] = useState<number>(
    editing?.purchasePrice ?? NaN,
  );
  const [unit, setUnit] = useState<string | null>(editing?.unit ?? null);
  const [hsnSac, setHsnSac] = useState(editing?.hsnSac ?? '');
  const [gstRate, setGstRate] = useState<number>(editing?.gstRate ?? 0);
  const [trackStock, setTrackStock] = useState(editing?.trackStock ?? false);
  const [stockQty, setStockQty] = useState<number>(editing?.stockQty ?? NaN);
  const [error, setError] = useState<string | null>(null);

  const onSave = () => {
    if (!name.trim()) {
      setError('Enter an item name');
      return;
    }
    if (Number.isNaN(salePrice) || salePrice < 0) {
      setError('Enter a valid sale price');
      return;
    }
    const draft: ItemDraft = {
      name: name.trim(),
      type,
      salePrice,
      purchasePrice: Number.isNaN(purchasePrice) ? 0 : purchasePrice,
      unit,
      hsnSac: hsnSac.trim() || null,
      gstRate,
      trackStock,
      stockQty: trackStock && !Number.isNaN(stockQty) ? stockQty : 0,
    };

    const onSuccess = () => navigation.goBack();
    const onError = (e: unknown) =>
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again.');

    if (editing) {
      update.mutate({id: editing.id, draft}, {onSuccess, onError});
    } else {
      create.mutate(draft, {onSuccess, onError});
    }
  };

  const onDelete = () => {
    if (!editing) return;
    Alert.alert('Delete item?', `Remove "${editing.name}" from your catalog?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(editing.id, {onSuccess: () => navigation.goBack()}),
      },
    ]);
  };

  const saving = create.isPending || update.isPending;

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{editing ? 'Edit item' : 'New item'}</Text>

        <View className="mt-6" style={{gap: 18}}>
          <FormField label="Name" required error={error?.includes('name') ? error : null}>
            <TextField
              placeholder="e.g. Cement Bag 50kg"
              value={name}
              onChangeText={v => {
                setName(v);
                if (error) setError(null);
              }}
              maxLength={120}
            />
          </FormField>

          <FormField label="Type">
            <SegmentedControl value={type} options={TYPE_OPTIONS} onChange={setType} />
          </FormField>

          <FormField
            label="Sale price"
            required
            error={error?.includes('price') ? error : null}>
            <AmountInput
              value={salePrice}
              onChange={v => {
                setSalePrice(v);
                if (error) setError(null);
              }}
            />
          </FormField>

          <FormField label="Purchase price" hint="Optional — for profit tracking">
            <AmountInput value={purchasePrice} onChange={setPurchasePrice} />
          </FormField>

          <FormField label="Unit" hint="Optional">
            <Select
              placeholder="Select unit"
              options={ITEM_UNITS as unknown as string[]}
              value={unit}
              onSelect={setUnit}
            />
          </FormField>

          <FormField label="HSN / SAC code" hint="Optional — for GST invoices">
            <TextField
              placeholder="e.g. 2523"
              value={hsnSac}
              onChangeText={setHsnSac}
              autoCapitalize="characters"
              maxLength={12}
            />
          </FormField>

          <FormField label="GST rate">
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {GST_RATES.map(r => (
                <FilterChip
                  key={r}
                  label={`${r}%`}
                  selected={gstRate === r}
                  onPress={() => setGstRate(r)}
                />
              ))}
            </View>
          </FormField>

          <FormField label="Track stock">
            <SegmentedControl
              value={trackStock}
              options={STOCK_OPTIONS}
              onChange={setTrackStock}
            />
          </FormField>

          {trackStock ? (
            <FormField label="Opening / current stock">
              <AmountInput value={stockQty} onChange={setStockQty} />
            </FormField>
          ) : null}
        </View>

        <Button
          title={editing ? 'Save changes' : 'Add item'}
          className="mt-8"
          loading={saving}
          onPress={onSave}
        />
        {editing ? (
          <Button
            title="Delete item"
            variant="ghost"
            className="mt-2"
            onPress={onDelete}
          />
        ) : (
          <Button
            title="Cancel"
            variant="ghost"
            className="mt-2"
            onPress={() => navigation.goBack()}
          />
        )}
      </View>
    </Screen>
  );
}
