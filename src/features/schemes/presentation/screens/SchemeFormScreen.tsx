import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, FormField, TextField} from '@components/form';
import {Button, Screen, SegmentedControl, Text} from '@components/ui';
import {itemRemote} from '@features/items/data/item.remote';
import type {Item} from '@features/items/domain/entities';
import type {SchemeInput, SchemeType} from '@features/schemes/data/schemes.remote';
import {useSchemeMutations} from '@features/schemes/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {todayIST} from '@utils/date';

const TYPES: SchemeType[] = ['buy_get', 'slab', 'percent', 'free_goods'];
const digits = (v: string) => v.replace(/[^\d.]/g, '');

/** Owner: set up a scheme — SKUs, dates, priority and the offer itself.
 *  The server validates everything; edits apply to new bills only. */
export function SchemeFormScreen({navigation, route}: AppScreenProps<'SchemeForm'>): React.JSX.Element {
  const t = useT();
  const editing = route.params?.scheme;
  const {save, remove} = useSchemeMutations();
  const catalog = useQuery({queryKey: ['items', 'schemes'], queryFn: () => itemRemote.list('', 100)});
  const products: Item[] = (catalog.data?.items ?? []).filter((i: Item) => i.type === 'product');

  const today = todayIST();
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<SchemeType>(editing?.type ?? 'buy_get');
  const [itemIds, setItemIds] = useState<string[]>(editing?.itemIds ?? []);
  const [validFrom, setValidFrom] = useState(editing?.validFrom ?? today);
  const [validTo, setValidTo] = useState(editing?.validTo ?? today);
  const [priority, setPriority] = useState(String(editing?.priority ?? ''));
  const [active, setActive] = useState(editing?.active ?? true);
  const [buyQty, setBuyQty] = useState(editing?.buyQty ?? '10');
  const [freeQty, setFreeQty] = useState(editing?.freeQty ?? '1');
  const [minQty, setMinQty] = useState(editing?.minQty ?? '');
  const [percent, setPercent] = useState(editing?.percent ?? '');
  const [freeItemId, setFreeItemId] = useState<string | null>(editing?.freeItemId ?? null);
  const [slabs, setSlabs] = useState<[string, string][]>(editing?.slabs ?? [['', '']]);

  const toggle = (id: string) => setItemIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

  const onSave = () => {
    const input: SchemeInput = {
      name: name.trim(), type, itemIds, validFrom, validTo, priority: Number(priority), active,
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
        <FormField label={t('schemes.type')} required>
          <View className="flex-row flex-wrap" style={{gap: 8}}>
            {TYPES.map(k => (
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
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {products.map(i => (
                  <FilterChip key={i.id} label={i.name} selected={freeItemId === i.id} onPress={() => setFreeItemId(i.id)} />
                ))}
              </View>
            </FormField>
          </>
        ) : null}
        {type === 'percent' ? (
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

        <FormField label={t('schemes.items')} required>
          <View className="flex-row flex-wrap" style={{gap: 8}}>
            {products.map(i => (
              <FilterChip key={i.id} label={i.name} selected={itemIds.includes(i.id)} onPress={() => toggle(i.id)} />
            ))}
          </View>
        </FormField>
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
