import React, {useEffect, useState} from 'react';
import {Alert, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, FormField, TextField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import type {Van} from '@features/stock/data/stock.remote';
import {formatQty, isQty} from '@features/stock/domain/qty';
import {makeStockClientId, useStockMutations} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';
import {toISODate} from '@utils/date';

export type StockAction = 'purchase' | 'sale' | 'transfer';

/** Where stock can come from: the godown or one salesperson's van. */
type Source = {location: 'godown'} | {location: 'van'; vanUserId?: string};

/**
 * Purchase (into the godown), sale (out of the godown or a van) or loading a
 * van from the godown. `ownVanOnly`: staff selling from their own van.
 */
export function StockMoveSheet({
  action,
  item,
  vans,
  ownVanOnly = false,
  onClose,
}: {
  action: StockAction | null;
  item: {id: string; name: string; unit: string | null; godown?: string; vanQty?: Record<string, string>} | null;
  vans: Van[];
  ownVanOnly?: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const {record, transfer} = useStockMutations();
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');
  const [source, setSource] = useState<Source>({location: 'godown'});
  const [vanUserId, setVanUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A fresh id per opened sheet: a double-tap or retry is saved once.
  const [clientId, setClientId] = useState(makeStockClientId);

  useEffect(() => {
    setQty('');
    setNote('');
    setError(null);
    setDate(toISODate(new Date()));
    setSource(ownVanOnly ? {location: 'van'} : {location: 'godown'});
    setVanUserId(null);
    setClientId(makeStockClientId());
  }, [action, item?.id, ownVanOnly]);

  const pending = record.isPending || transfer.isPending;
  const vanLabel = (v: Van) => `🚚 ${v.mobile}`;

  const submit = () => {
    if (!action || !item) return;
    if (!isQty(qty)) {
      setError(t('stock.qtyError'));
      return;
    }
    const done = {onSuccess: onClose, onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message)};
    const base = {clientId, itemId: item.id, quantity: qty.trim(), date, note: note.trim() || undefined};
    if (action === 'transfer') {
      if (!vanUserId) {
        setError(t('stock.pickVan'));
        return;
      }
      transfer.mutate({...base, vanUserId}, done);
    } else if (action === 'purchase') {
      record.mutate({...base, kind: 'purchase', location: 'godown'}, done);
    } else {
      record.mutate(
        {...base, kind: 'sale', location: source.location,
          vanUserId: source.location === 'van' && !ownVanOnly ? source.vanUserId : undefined},
        done,
      );
    }
  };

  const title = action ? t(`stock.action.${action}`) : '';
  return (
    <BottomSheet visible={action !== null && item !== null} onClose={onClose} title={title}
      maxHeightClassName="max-h-[90%]">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap: 16, paddingBottom: 24}}>
        <Text className="text-base font-semibold text-slate-900">{item?.name}</Text>

        {action === 'sale' && !ownVanOnly ? (
          <FormField label={t('stock.sellFrom')}>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              <FilterChip
                label={`🏬 ${t('stock.godown')} · ${formatQty(item?.godown ?? '0')}`}
                selected={source.location === 'godown'}
                onPress={() => setSource({location: 'godown'})}
              />
              {vans
                .filter(v => item?.vanQty?.[v.userId])
                .map(v => (
                  <FilterChip
                    key={v.userId}
                    label={`${vanLabel(v)} · ${formatQty(item?.vanQty?.[v.userId] ?? '0')}`}
                    selected={source.location === 'van' && source.vanUserId === v.userId}
                    onPress={() => setSource({location: 'van', vanUserId: v.userId})}
                  />
                ))}
            </View>
          </FormField>
        ) : null}

        {action === 'transfer' ? (
          <FormField label={t('stock.toVan')} required>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {vans.map(v => (
                <FilterChip key={v.userId} label={vanLabel(v)} selected={vanUserId === v.userId}
                  onPress={() => setVanUserId(v.userId)} />
              ))}
            </View>
            <Text variant="caption" className="mt-1">
              {t('stock.inGodown', {qty: formatQty(item?.godown ?? '0', item?.unit)})}
            </Text>
          </FormField>
        ) : null}

        <FormField label={t('stock.quantity')} required error={error}>
          <TextField
            value={qty}
            onChangeText={v => {
              setQty(v.replace(/[^\d.]/g, ''));
              setError(null);
            }}
            keyboardType="decimal-pad"
            placeholder={item?.unit ?? '0'}
            error={error}
            autoFocus
          />
        </FormField>
        <FormField label={t('form.date')} required>
          <DateField value={date} onChange={setDate} />
        </FormField>
        <FormField label={t('form.notes')} hint={t('common.optional')}>
          <TextField value={note} onChangeText={setNote} maxLength={200} />
        </FormField>
        <Button title={title} loading={pending} onPress={submit} />
      </ScrollView>
    </BottomSheet>
  );
}
