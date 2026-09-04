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
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

export function ItemFormScreen({
  navigation,
  route,
}: AppScreenProps<'ItemForm'>): React.JSX.Element {
  const t = useT();
  const editing = route.params?.item;
  const {create, update, remove} = useItemMutations();

  const TYPE_OPTIONS = [
    {label: t('items.product'), value: 'product' as ItemType},
    {label: t('items.service'), value: 'service' as ItemType},
  ];
  const STOCK_OPTIONS = [
    {label: t('common.on'), value: true},
    {label: t('common.off'), value: false},
  ];

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
  const [errorField, setErrorField] = useState<'name' | 'price' | null>(null);
  const clearError = () => {
    if (error) {
      setError(null);
      setErrorField(null);
    }
  };

  const onSave = () => {
    if (!name.trim()) {
      setError(t('items.errName'));
      setErrorField('name');
      return;
    }
    if (Number.isNaN(salePrice) || salePrice < 0) {
      setError(t('items.errPrice'));
      setErrorField('price');
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
      Alert.alert(
        t('form.couldNotSave'),
        e instanceof Error ? e.message : t('ai.tryAgain'),
      );

    if (editing) {
      update.mutate({id: editing.id, draft}, {onSuccess, onError});
    } else {
      create.mutate(draft, {onSuccess, onError});
    }
  };

  const onDelete = () => {
    if (!editing) return;
    Alert.alert(
      t('items.deleteTitle'),
      t('items.deleteMsg', {name: editing.name}),
      [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('common.delete'),
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
        <Text variant="title">
          {editing ? t('items.editTitle') : t('items.newTitle')}
        </Text>

        <View className="mt-6" style={{gap: 18}}>
          <FormField
            label={t('items.name')}
            required
            error={errorField === 'name' ? error : null}>
            <TextField
              placeholder={t('items.namePlaceholder')}
              value={name}
              onChangeText={v => {
                setName(v);
                clearError();
              }}
              maxLength={120}
            />
          </FormField>

          <FormField label={t('items.type')}>
            <SegmentedControl value={type} options={TYPE_OPTIONS} onChange={setType} />
          </FormField>

          <FormField
            label={t('items.salePrice')}
            required
            error={errorField === 'price' ? error : null}>
            <AmountInput
              value={salePrice}
              onChange={v => {
                setSalePrice(v);
                clearError();
              }}
            />
          </FormField>

          <FormField label={t('items.purchasePrice')} hint={t('items.purchaseHint')}>
            <AmountInput value={purchasePrice} onChange={setPurchasePrice} />
          </FormField>

          <FormField label={t('items.unit')} hint={t('common.optional')}>
            <Select
              placeholder={t('items.selectUnit')}
              options={ITEM_UNITS as unknown as string[]}
              value={unit}
              onSelect={setUnit}
            />
          </FormField>

          <FormField label={t('items.hsnSac')} hint={t('items.hsnHint')}>
            <TextField
              placeholder={t('items.hsnPlaceholder')}
              value={hsnSac}
              onChangeText={setHsnSac}
              autoCapitalize="characters"
              maxLength={12}
            />
          </FormField>

          <FormField label={t('items.gstRate')}>
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

          <FormField label={t('items.trackStock')}>
            <SegmentedControl
              value={trackStock}
              options={STOCK_OPTIONS}
              onChange={setTrackStock}
            />
          </FormField>

          {trackStock ? (
            <FormField label={t('items.stockLabel')}>
              <AmountInput value={stockQty} onChange={setStockQty} />
            </FormField>
          ) : null}
        </View>

        <Button
          title={editing ? t('items.saveChanges') : t('items.addItem')}
          className="mt-8"
          loading={saving}
          onPress={onSave}
        />
        {editing ? (
          <Button
            title={t('items.deleteItem')}
            variant="ghost"
            className="mt-2"
            onPress={onDelete}
          />
        ) : (
          <Button
            title={t('common.cancel')}
            variant="ghost"
            className="mt-2"
            onPress={() => navigation.goBack()}
          />
        )}
      </View>
    </Screen>
  );
}
