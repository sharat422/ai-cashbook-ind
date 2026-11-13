import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, FormField, TextField} from '@components/form';
import {Button, Screen, SegmentedControl, Text} from '@components/ui';
import {customerRemote} from '@features/customers/data/customer.remote';
import {ItemPicker} from '@features/items/presentation/components/ItemPicker';
import type {SchemeInput, SchemeType} from '@features/schemes/data/schemes.remote';
import {useSchemeMutations} from '@features/schemes/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {todayIST} from '@utils/date';

const TYPES: SchemeType[] = ['buy_get', 'slab', 'percent', 'free_goods'];
const BILL_TYPES: SchemeType[] = ['amount_off', 'percent'];
const digits = (v: string) => v.replace(/[^\d.]/g, '');

/** Owner: set up a scheme — SKUs, dates, priority and the offer itself.
 *  The server validates everything; edits apply to new bills only. */
export function SchemeFormScreen({navigation, route}: AppScreenProps<'SchemeForm'>): React.JSX.Element {
  const t = useT();
  const editing = route.params?.scheme;
  const {save, remove} = useSchemeMutations();

  const today = todayIST();
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<SchemeType>(editing?.type ?? 'buy_get');
  // Picked from the paged catalogue search; names come with the scheme when editing.
  const [picked, setPicked] = useState<{id: string; name: string}[]>(
    (editing?.itemIds ?? []).map((id, i) => ({id, name: editing?.itemNames?.[i] || id})));
  const itemIds = picked.map(p => p.id);
  const [validFrom, setValidFrom] = useState(editing?.validFrom ?? today);
  const [validTo, setValidTo] = useState(editing?.validTo ?? today);
  const [priority, setPriority] = useState(String(editing?.priority ?? ''));
  const [together, setTogether] = useState(editing?.scope === 'sku_group');
  const [level, setLevel] = useState<'line' | 'bill'>(editing?.level ?? 'line');
  const [minBillValue, setMinBillValue] = useState(editing?.minBillValue ?? '');
  const [amountOff, setAmountOff] = useState(editing?.amountOff ?? '');
  const [retailerId, setRetailerId] = useState<string | null>(editing?.retailerId ?? null);
  const retailers = useQuery({queryKey: ['customers', 'schemes'],
    queryFn: () => customerRemote.list({search: '', cursor: null, limit: 30}),
    enabled: level === 'bill'});
  const [active, setActive] = useState(editing?.active ?? true);
  const [buyQty, setBuyQty] = useState(editing?.buyQty ?? '10');
  const [freeQty, setFreeQty] = useState(editing?.freeQty ?? '1');
  const [minQty, setMinQty] = useState(editing?.minQty ?? '');
  const [percent, setPercent] = useState(editing?.percent ?? '');
  const [freeItem, setFreeItem] = useState<{id: string; name: string} | null>(
    editing?.freeItemId ? {id: editing.freeItemId, name: editing.freeItemName || editing.freeItemId} : null);
  const freeItemId = freeItem?.id ?? null;
  const [slabs, setSlabs] = useState<[string, string][]>(editing?.slabs ?? [['', '']]);

  const unpick = (id: string) => setPicked(ps => ps.filter(p => p.id !== id));

  const onSave = () => {
    const input: SchemeInput = {
      name: name.trim(), type, itemIds, validFrom, validTo, priority: Number(priority), active,
      scope: together && itemIds.length > 1 ? 'sku_group' : 'single_sku',
      level,
      minBillValue: level === 'bill' ? minBillValue || '0' : null,
      retailerId: level === 'bill' ? retailerId : null,
      amountOff: level === 'bill' && type === 'amount_off' ? amountOff : null,
      buyQty: type === 'buy_get' ? buyQty : null,
      freeQty: type === 'buy_get' || type === 'free_goods' ? freeQty : null,
      freeItemId: type === 'free_goods' ? freeItemId : null,
      minQty: type === 'percent' || type === 'free_goods' ? minQty || null : null,
      percent: type === 'percent' ? percent : null,
      slabs: type === 'slab' ? slabs.filter(([q, p]) => q || p) : null,
    };
    save.mutate(
      {id: editing?.id, input},
      {onSuccess: () => navigation.goBack(), onError: e => Alert.alert(t('form.couldNotSave'), e.message)},
    );
  };

  const onDelete = () =>
    editing &&
    Alert.alert(t('schemes.deleteTitle'), t('schemes.deleteMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('schemes.delete'), style: 'destructive',
        onPress: () => remove.mutate(editing.id, {onSuccess: () => navigation.goBack()})},
    ]);

  return (
    <Screen scroll={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingVertical: 24, paddingBottom: 40, gap: 18}}>
        <Text variant="title">{editing ? t('schemes.editTitle') : t('schemes.add')}</Text>
        <FormField label={t('schemes.name')} required>
          <TextField value={name} onChangeText={setName} placeholder={t('schemes.namePlaceholder')} maxLength={120} />
        </FormField>
        <SegmentedControl
          label={t('schemes.level')}
          value={level}
          options={[{label: t('schemes.levelLine'), value: 'line' as const}, {label: t('schemes.levelBill'), value: 'bill' as const}]}
          onChange={v => {
            setLevel(v);
            setType(v === 'bill' ? 'amount_off' : 'buy_get');
          }}
        />
        {level === 'bill' ? (
          <>
            <Text testID="scheme-bill-hint" variant="caption">{t('schemes.levelBillHint')}</Text>
            {type === 'amount_off' ? (
              <FormField label={t('schemes.amountOff')} required>
                <TextField testID="scheme-amount-off" value={amountOff} onChangeText={v => setAmountOff(digits(v))} keyboardType="decimal-pad" />
              </FormField>
            ) : null}
            <FormField label={t('schemes.minBillValue')} required>
              <TextField testID="scheme-min-bill" value={minBillValue} onChangeText={v => setMinBillValue(digits(v))} keyboardType="decimal-pad" />
            </FormField>
            <FormField label={t('schemes.retailer')} hint={t('schemes.retailerHint')}>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                <FilterChip label={t('schemes.allRetailers')} selected={retailerId === null} onPress={() => setRetailerId(null)} />
                {(retailers.data?.items ?? []).slice(0, 30).map((c: {id: string; fullName: string}) => (
                  <FilterChip key={c.id} label={c.fullName} selected={retailerId === c.id} onPress={() => setRetailerId(c.id)} />
                ))}
              </View>
            </FormField>
          </>
        ) : null}
        <FormField label={t('schemes.type')} required>
          <View className="flex-row flex-wrap" style={{gap: 8}}>
            {(level === 'bill' ? BILL_TYPES : TYPES).map(k => (
              <FilterChip key={k} label={t(`schemes.type.${k}`)} selected={type === k} onPress={() => setType(k)} />
            ))}
          </View>
        </FormField>

        {type === 'buy_get' ? (
          <View className="flex-row" style={{gap: 10}}>
            <View className="flex-1">
              <FormField label={t('schemes.buy')} required>
                <TextField value={buyQty} onChangeText={v => setBuyQty(digits(v))} keyboardType="number-pad" />
              </FormField>
            </View>
            <View className="flex-1">
              <FormField label={t('schemes.getFree')} required>
                <TextField value={freeQty} onChangeText={v => setFreeQty(digits(v))} keyboardType="number-pad" />
              </FormField>
            </View>
          </View>
        ) : null}
        {type === 'free_goods' ? (
          <>
            <View className="flex-row" style={{gap: 10}}>
              <View className="flex-1">
                <FormField label={t('schemes.everyQty')} required>
                  <TextField value={minQty} onChangeText={v => setMinQty(digits(v))} keyboardType="number-pad" />
                </FormField>
              </View>
              <View className="flex-1">
                <FormField label={t('schemes.getFree')} required>
                  <TextField value={freeQty} onChangeText={v => setFreeQty(digits(v))} keyboardType="number-pad" />
                </FormField>
              </View>
            </View>
            <FormField label={t('schemes.freeItem')} required>
              <View style={{gap: 8}}>
                {freeItem ? <FilterChip testID="free-item" label={freeItem.name} selected onPress={() => setFreeItem(null)} /> : null}
                <ItemPicker testID="free-item-picker" label={t('schemes.freeItem')} placeholder={t('bill.addItemPlaceholder')}
                  excludeIds={freeItemId ? [freeItemId] : []} onPick={i => setFreeItem({id: i.id, name: i.name})} />
              </View>
            </FormField>
          </>
        ) : null}
        {type === 'percent' && level === 'bill' ? (
          <FormField label={t('schemes.percent')} required>
            <TextField value={percent} onChangeText={v => setPercent(digits(v))} keyboardType="decimal-pad" />
          </FormField>
        ) : null}
        {type === 'percent' && level === 'line' ? (
          <View className="flex-row" style={{gap: 10}}>
            <View className="flex-1">
              <FormField label={t('schemes.percent')} required>
                <TextField value={percent} onChangeText={v => setPercent(digits(v))} keyboardType="decimal-pad" />
              </FormField>
            </View>
            <View className="flex-1">
              <FormField label={t('schemes.minQty')} hint={t('common.optional')}>
                <TextField value={minQty} onChangeText={v => setMinQty(digits(v))} keyboardType="decimal-pad" />
              </FormField>
            </View>
          </View>
        ) : null}
        {type === 'slab' ? (
          <FormField label={t('schemes.slabs')} hint={t('schemes.slabsHint')} required>
            <View style={{gap: 8}}>
              {slabs.map(([q, p], i) => (
                <View key={i} className="flex-row items-center" style={{gap: 8}}>
                  <View className="flex-1">
                    <TextField value={q} placeholder={t('schemes.fromQty')} keyboardType="decimal-pad"
                      onChangeText={v => setSlabs(s => s.map((x, j) => (j === i ? [digits(v), x[1]] : x)))} />
                  </View>
                  <View className="flex-1">
                    <TextField value={p} placeholder={t('schemes.percentOff')} keyboardType="decimal-pad"
                      onChangeText={v => setSlabs(s => s.map((x, j) => (j === i ? [x[0], digits(v)] : x)))} />
                  </View>
                  <Pressable accessibilityLabel={t('schemes.removeSlab')} onPress={() => setSlabs(s => s.filter((_, j) => j !== i))}>
                    <Text className="text-lg text-slate-400">✕</Text>
                  </Pressable>
                </View>
              ))}
              {slabs.length < 10 ? (
                <Button title={t('schemes.addSlab')} variant="ghost" onPress={() => setSlabs(s => [...s, ['', '']])} />
              ) : null}
            </View>
          </FormField>
        ) : null}

        {level === 'line' ? (
        <>
        <FormField label={t('schemes.items')} required>
          <View style={{gap: 8}}>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {picked.map(i => (
                <FilterChip key={i.id} testID={`scheme-item-${i.id}`} label={`${i.name} ✕`} selected onPress={() => unpick(i.id)} />
              ))}
            </View>
            <ItemPicker testID="scheme-item-picker" label={t('bill.addItem')} placeholder={t('bill.addItemPlaceholder')}
              excludeIds={itemIds} onPick={i => setPicked(ps => [...ps, {id: i.id, name: i.name}])} />
          </View>
        </FormField>
        {itemIds.length > 1 ? (
          <SegmentedControl
            label={t('schemes.scope')}
            value={together}
            options={[
              {label: t('schemes.scopeEach'), value: false},
              {label: t('schemes.scopeTogether'), value: true},
            ]}
            onChange={setTogether}
          />
        ) : null}
        {itemIds.length > 1 && together ? (
          <Text testID="scheme-group" variant="caption">
            {t('schemes.scopeTogetherHint', {items: picked.map(i => i.name).join(' + ')})}
          </Text>
        ) : null}
        </>
        ) : null}
        <View className="flex-row" style={{gap: 10}}>
          <View className="flex-1">
            <FormField label={t('schemes.from')} required>
              <DateField value={validFrom} onChange={setValidFrom} />
            </FormField>
          </View>
          <View className="flex-1">
            <FormField label={t('schemes.to')} required>
              <DateField value={validTo} onChange={setValidTo} />
            </FormField>
          </View>
        </View>
        <FormField label={t('schemes.priority')} hint={t('schemes.priorityHint')} required>
          <TextField value={priority} onChangeText={v => setPriority(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="1" />
        </FormField>
        <SegmentedControl
          label={t('schemes.active')}
          value={active}
          options={[{label: t('common.on'), value: true}, {label: t('common.off'), value: false}]}
          onChange={setActive}
        />
        <Button title={t('schemes.save')} loading={save.isPending} onPress={onSave} />
        {editing ? <Button title={t('schemes.delete')} variant="ghost" onPress={onDelete} /> : null}
      </ScrollView>
    </Screen>
  );
}
