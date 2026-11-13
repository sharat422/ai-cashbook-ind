import {personLabel} from '@utils/personLabel';
import {useQuery} from '@tanstack/react-query';
import React, {useEffect, useState} from 'react';
import {Alert, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, FormField, TextField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import {stockRemote, type Supplier, type Van} from '@features/stock/data/stock.remote';
import {formatQty, isQty} from '@features/stock/domain/qty';
import {makeStockClientId, useStockMutations} from '@features/stock/presentation/hooks';
import {useT} from '@/i18n';
import {todayIST} from '@utils/date';

export type StockAction = 'purchase' | 'sale' | 'transfer';

/** Where stock can come from: the godown or one salesperson's van. */
type Source = {location: 'godown'} | {location: 'van'; vanUserId?: string};

/** Same place? (A staff member's own van has no id on their side: it's "van".) */
const samePlace = (a: Source, b: Source): boolean =>
  a.location === b.location && (a.location === 'godown' || a.vanUserId === (b as {vanUserId?: string}).vanUserId);

/**
 * Purchase (into the godown), sale (out of the godown or a van) or a move
 * between places: godown → van, van → godown (a return), van → van.
 * `ownVanOnly`: staff, who sell and move only out of their own van.
 */
export function StockMoveSheet({
  action,
  item,
  vans,
  ownVanOnly = false,
  onClose,
}: {
  action: StockAction | null;
  item: {id: string; name: string; unit: string | null; godown?: string; vanQty?: Record<string, string>;
    purchasePrice?: number; units?: {unit: string; factor: string}[]} | null;
  vans: Van[];
  ownVanOnly?: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const {record, transfer} = useStockMutations();
  const [qty, setQty] = useState('');
  /** The unit the quantity is typed in: null = the base unit. */
  const [unit, setUnit] = useState<string | null>(null);
  const [date, setDate] = useState(todayIST());
  const [note, setNote] = useState('');
  const [supplier, setSupplier] = useState('');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const suppliers = useQuery({queryKey: ['suppliers'], queryFn: stockRemote.suppliers, enabled: action === 'purchase'});
  // Suppliers on the list whose name contains what's typed (all of them while it's empty).
  const typed = supplier.trim().toLowerCase();
  const matches: Supplier[] = supplierId ? [] : (suppliers.data ?? [])
    .filter((s: Supplier) => !typed || s.name.toLowerCase().includes(typed)).slice(0, 6);
  const [unitPrice, setUnitPrice] = useState('');
  const [billRef, setBillRef] = useState('');
  const [supplierGstin, setSupplierGstin] = useState('');
  const [gstRate, setGstRate] = useState('');
  const [gstAmount, setGstAmount] = useState('');
  const [source, setSource] = useState<Source>({location: 'godown'});
  const [dest, setDest] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A fresh id per opened sheet: a double-tap or retry is saved once.
  const [clientId, setClientId] = useState(makeStockClientId);

  useEffect(() => {
    setQty('');
    setUnit(null);
    setNote('');
    setSupplier('');
    setSupplierId(null);
    setUnitPrice(item?.purchasePrice ? String(item.purchasePrice) : '');
    setBillRef('');
    setError(null);
    setDate(todayIST());
    setSource(ownVanOnly ? {location: 'van'} : {location: 'godown'});
    setDest(null);
    setClientId(makeStockClientId());
  }, [action, item?.id, ownVanOnly]);

  const pending = record.isPending || transfer.isPending;
  const vanLabel = (v: Van) => `🚚 ${personLabel(v.name, v.mobile)}`;

  const submit = () => {
    if (!action || !item) return;
    if (!isQty(qty)) {
      setError(t('stock.qtyError'));
      return;
    }
    const done = {onSuccess: onClose, onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message)};
    const base = {clientId, itemId: item.id, itemName: item.name, quantity: qty.trim(), unit: unit ?? undefined,
      date, note: note.trim() || undefined};
    if (action === 'transfer') {
      if (!dest || samePlace(source, dest)) {
        setError(t('stock.pickDestination'));
        return;
      }
      transfer.mutate({
        ...base,
        fromLocation: source.location,
        fromVanUserId: source.location === 'van' && !ownVanOnly ? source.vanUserId : undefined,
        toLocation: dest.location,
        vanUserId: dest.location === 'van' ? dest.vanUserId : undefined,
      }, done);
    } else if (action === 'purchase') {
      if (!supplier.trim() || !billRef.trim() || !isQty(unitPrice || 'x')) {
        setError(t('stock.purchaseDetails'));
        return;
      }
      if (!gstRate.trim() !== !gstAmount.trim()) { // both or neither, as on the bill
        setError(t('stock.purchaseGstBoth'));
        return;
      }
      record.mutate({...base, kind: 'purchase', location: 'godown', supplierId: supplierId ?? undefined,
        supplier: supplier.trim(),
        unitPrice: unitPrice.trim(), billRef: billRef.trim(),
        supplierGstin: supplierGstin.trim() || undefined,
        gstRate: gstRate.trim() || undefined, gstAmount: gstAmount.trim() || undefined}, done);
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

        {action === 'transfer' && !ownVanOnly ? (
          <FormField label={t('stock.moveFrom')} required>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              <FilterChip testID="move-from-godown"
                label={`🏬 ${t('stock.godown')} · ${formatQty(item?.godown ?? '0')}`}
                selected={source.location === 'godown'}
                onPress={() => setSource({location: 'godown'})} />
              {vans.filter(v => item?.vanQty?.[v.userId]).map(v => (
                <FilterChip key={v.userId} testID={`move-from-${v.userId}`}
                  label={`${vanLabel(v)} · ${formatQty(item?.vanQty?.[v.userId] ?? '0')}`}
                  selected={source.location === 'van' && source.vanUserId === v.userId}
                  onPress={() => setSource({location: 'van', vanUserId: v.userId})} />
              ))}
            </View>
          </FormField>
        ) : null}
        {action === 'transfer' ? (
          <FormField label={t('stock.moveTo')} required>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {source.location !== 'godown' ? (
                <FilterChip testID="move-to-godown" label={`🏬 ${t('stock.godown')}`}
                  selected={dest?.location === 'godown'} onPress={() => setDest({location: 'godown'})} />
              ) : null}
              {vans.filter(v => !samePlace(source, {location: 'van', vanUserId: v.userId})).map(v => (
                <FilterChip key={v.userId} testID={`move-to-${v.userId}`} label={vanLabel(v)}
                  selected={dest?.location === 'van' && dest.vanUserId === v.userId}
                  onPress={() => setDest({location: 'van', vanUserId: v.userId})} />
              ))}
            </View>
          </FormField>
        ) : null}

        {item?.units?.length ? (
          <View className="flex-row flex-wrap" style={{gap: 8}}>
            {[{unit: item.unit ?? '', factor: '1'}, ...item.units].map(u => (
              <FilterChip key={u.unit} testID={`unit-${u.unit}`}
                label={u.factor === '1' ? u.unit : `${u.unit} (${formatQty(u.factor)} ${item.unit ?? ''})`.trim()}
                selected={(unit ?? item.unit) === u.unit}
                onPress={() => setUnit(u.unit === item.unit ? null : u.unit)} />
            ))}
          </View>
        ) : null}
        <FormField label={t('stock.quantity')} required error={error}>
          <TextField
            value={qty}
            onChangeText={v => {
              setQty(v.replace(/[^\d.]/g, ''));
              setError(null);
            }}
            keyboardType="decimal-pad"
            placeholder={unit ?? item?.unit ?? '0'}
            error={error}
            autoFocus
          />
        </FormField>
        {action === 'purchase' ? (
          <>
            <FormField label={t('stock.supplier')} required>
              <TextField testID="purchase-supplier" value={supplier} maxLength={200}
                onChangeText={v => {
                  setSupplier(v);
                  setSupplierId(null); // typing: a new name, or pick a match below
                }} />
              {matches.length ? (
                <View className="mt-2 flex-row flex-wrap" style={{gap: 8}}>
                  {matches.map(s => (
                    <FilterChip key={s.id} testID={`supplier-${s.id}`} label={s.name} selected={false}
                      onPress={() => {
                        setSupplier(s.name);
                        setSupplierId(s.id);
                        if (s.gstin && !supplierGstin) setSupplierGstin(s.gstin);
                      }} />
                  ))}
                </View>
              ) : null}
              {supplierId ? <Text variant="caption" className="mt-1">{t('stock.supplierFromList')}</Text> :
                supplier.trim() ? <Text variant="caption" className="mt-1">{t('stock.supplierNew')}</Text> : null}
            </FormField>
            <FormField label={t('stock.unitPrice')} required>
              <TextField testID="purchase-price" value={unitPrice} keyboardType="decimal-pad"
                onChangeText={v => setUnitPrice(v.replace(/[^\d.]/g, ''))} />
            </FormField>
            <FormField label={t('stock.billRef')} required>
              <TextField testID="purchase-bill" value={billRef} onChangeText={setBillRef} maxLength={40}
                autoCapitalize="characters" />
            </FormField>
            {/* GST on the supplier's bill: optional, for the CA's ITC review (never a claim). */}
            <FormField label={t('stock.supplierGstin')} hint={t('common.optional')}>
              <TextField testID="purchase-gstin" value={supplierGstin} maxLength={15} autoCapitalize="characters"
                onChangeText={v => setSupplierGstin(v.toUpperCase())} />
            </FormField>
            <View className="flex-row" style={{gap: 8}}>
              <View className="flex-1">
                <FormField label={t('stock.purchaseGstRate')} hint={t('common.optional')}>
                  <TextField testID="purchase-gst-rate" value={gstRate} keyboardType="decimal-pad"
                    onChangeText={v => setGstRate(v.replace(/[^\d.]/g, ''))} />
                </FormField>
              </View>
              <View className="flex-1">
                <FormField label={t('stock.purchaseGstAmount')} hint={t('common.optional')}>
                  <TextField testID="purchase-gst-amount" value={gstAmount} keyboardType="decimal-pad"
                    onChangeText={v => setGstAmount(v.replace(/[^\d.]/g, ''))} />
                </FormField>
              </View>
            </View>
          </>
        ) : null}
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
