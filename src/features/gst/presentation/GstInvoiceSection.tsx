import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {View} from 'react-native';

import {FilterChip} from '@components/filters';
import {FormField, TextField} from '@components/form';
import {SegmentedControl, Select, Text} from '@components/ui';
import {INDIAN_STATES, type IndianState} from '@config/constants';
import {gstRemote} from '@features/gst/data/gst.remote';
import {GST_RATES, UQC_CODES, cleanGstin, isValidGstin, uqcForUnit, type GstField} from '@features/gst/domain/gst';
import type {Item} from '@features/items/domain/entities';
import {useItems} from '@features/items/presentation/hooks/useItems';
import {formatMoney} from '@features/reconciliation/domain/money';
import {GST_STATE_CODES, gstSplit, placeOfSupply} from '@features/gst/domain/gstSplit';
import {useAuthStore} from '@store/auth.store';
import {useT} from '@/i18n';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';

export interface GstForm {
  rate: string;
  hsn: string;
  quantity: string;
  uqc: string | null;
  itemId: string | null;
  priceIncludesGst: boolean;
  customerGstin: string;
  /** Only used when the customer has no GSTIN. */
  placeOfSupply: IndianState | null;
}

export const emptyGstForm = (customerGstin?: string): GstForm => ({
  rate: '18',
  hsn: '',
  quantity: '',
  uqc: null,
  itemId: null,
  priceIncludesGst: false,
  customerGstin: customerGstin ?? '',
  placeOfSupply: null,
});

/**
 * GST fields for a sale, with a live tax split that comes from the server's
 * calculation (POST /gst/preview); offline, the same formula on the phone (gstSplit.ts).
 */
export function GstInvoiceSection({
  value,
  onChange,
  amount,
  online,
  errorField,
  error,
}: {
  value: GstForm;
  onChange: (next: GstForm) => void;
  amount: number;
  online: boolean;
  errorField?: GstField | null;
  error?: string | null;
}): React.JSX.Element {
  const t = useT();
  const set = (patch: Partial<GstForm>) => onChange({...value, ...patch});
  const gstin = cleanGstin(value.customerGstin);
  const input = useDebouncedValue({
    amount,
    rate: value.rate,
    priceIncludesGst: value.priceIncludesGst,
    customerGstin: gstin || undefined,
    placeOfSupply: gstin ? undefined : value.placeOfSupply ?? undefined,
  });
  const ready = online && Number.isFinite(input.amount) && input.amount > 0 &&
    (!input.customerGstin || isValidGstin(input.customerGstin));
  const preview = useQuery({
    queryKey: ['gst-preview', input],
    queryFn: () => gstRemote.preview(input),
    enabled: ready,
    retry: false,
  });
  // Offline: the same formula as the server, on the phone (gstSplit.ts).
  const sellerGstin = useAuthStore(s => s.business?.gstin ?? '');
  const local = !online && sellerGstin && Number.isFinite(input.amount) && input.amount > 0 &&
    (!input.customerGstin || isValidGstin(input.customerGstin))
    ? (() => {
        const pos = placeOfSupply(sellerGstin, input.customerGstin, input.placeOfSupply);
        const inter = pos !== sellerGstin.slice(0, 2);
        const name = Object.keys(GST_STATE_CODES).find(k => GST_STATE_CODES[k] === pos) ?? '';
        return {...gstSplit(input.amount, input.rate, input.priceIncludesGst, inter),
          interState: inter, placeOfSupply: `${pos}-${name}`};
      })()
    : null;

  const items = useItems('');
  const products: Item[] = (items.data?.items ?? []).filter((i: Item) => i.type === 'product');
  const pickItem = (id: string) => {
    const item = products.find(i => i.id === id);
    if (!item) return;
    const rate = String(item.gstRate);
    set({
      itemId: id,
      hsn: (item.hsnSac ?? '').replace(/\D/g, '') || value.hsn,
      rate: (GST_RATES as readonly string[]).includes(rate) ? rate : value.rate, // an ended rate isn't copied
      uqc: uqcForUnit(item.unit) ?? value.uqc,
    });
  };

  return (
    <View className="rounded-2xl border border-border bg-white p-4" style={{gap: 16}}>
      {products.length > 0 ? (
        <Select
          label={t('gst.item')}
          placeholder={t('gst.itemPlaceholder')}
          value={value.itemId}
          options={products.map(i => i.id)}
          labelOf={id => {
            const i = products.find(x => x.id === id);
            return i ? `${i.name}${i.hsnSac ? ` · ${i.hsnSac}` : ''} · ${i.gstRate}%` : id;
          }}
          onSelect={pickItem}
        />
      ) : null}
      <FormField label={t('gst.customerGstin')} hint={t('gst.customerGstinHint')}
        error={errorField === 'gstin' ? error : null}>
        <TextField
          value={value.customerGstin}
          onChangeText={v => set({customerGstin: v.toUpperCase()})}
          placeholder="29ABCDE1234F1Z5"
          autoCapitalize="characters"
          maxLength={15}
          error={errorField === 'gstin' ? error : null}
        />
      </FormField>
      {gstin ? null : (
        <Select
          label={t('gst.customerState')}
          placeholder={t('gst.customerStatePlaceholder')}
          options={INDIAN_STATES}
          value={value.placeOfSupply}
          onSelect={v => set({placeOfSupply: v})}
        />
      )}
      <FormField label={t('gst.hsn')} required error={errorField === 'hsn' ? error : null}>
        <TextField
          value={value.hsn}
          onChangeText={v => set({hsn: v.replace(/\D/g, '')})}
          placeholder="1006"
          keyboardType="number-pad"
          maxLength={8}
          error={errorField === 'hsn' ? error : null}
        />
      </FormField>
      <View className="flex-row" style={{gap: 12}}>
        <View className="flex-1">
          <FormField label={t('gst.quantity')} required error={errorField === 'quantity' ? error : null}>
            <TextField
              testID="gst-quantity"
              value={value.quantity}
              onChangeText={v => set({quantity: v.replace(/[^0-9.]/g, '')})}
              placeholder="10"
              keyboardType="decimal-pad"
              maxLength={12}
              error={errorField === 'quantity' ? error : null}
            />
          </FormField>
        </View>
        <View className="flex-1">
          <Select
            label={t('gst.uqc')}
            placeholder={UQC_CODES[5] /* BOX */}
            value={value.uqc}
            options={UQC_CODES as unknown as string[]}
            onSelect={v => set({uqc: v})}
            error={errorField === 'uqc' ? error : null}
          />
        </View>
      </View>
      <FormField label={t('gst.rate')} required>
        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {GST_RATES.map(r => (
            <FilterChip key={r} label={`${r}%`} selected={value.rate === r} onPress={() => set({rate: r})} />
          ))}
        </View>
      </FormField>
      <SegmentedControl
        label={t('gst.priceIs')}
        value={value.priceIncludesGst}
        options={[
          {label: t('gst.excludes'), value: false},
          {label: t('gst.includes'), value: true},
        ]}
        onChange={v => set({priceIncludesGst: v})}
      />

      <View testID="gst-preview" className="rounded-xl bg-slate-50 p-3" style={{gap: 4}}>
        {!online && local ? (
          <>
            <Breakdown data={local} />
            <Text testID="gst-local" variant="caption">{t('gst.previewLocal')}</Text>
          </>
        ) : !online ? (
          <Text variant="caption">{t('gst.previewHint')}</Text>
        ) : !ready ? (
          <Text variant="caption">{t('gst.previewHint')}</Text>
        ) : preview.isError ? (
          <Text className="text-sm text-danger">{(preview.error as Error).message}</Text>
        ) : !preview.data ? (
          <Text variant="caption">{t('gst.previewLoading')}</Text>
        ) : (
          <Breakdown data={preview.data} />
        )}
      </View>
    </View>
  );
}

function Breakdown({data}: {data: {taxableValue: string; cgst: string; sgst: string; igst: string;
  total: string; interState: boolean; placeOfSupply: string}}): React.JSX.Element {
  const t = useT();
  return (
    <>
      <Line label={t('gst.taxableValue')} value={formatMoney(data.taxableValue)} />
      {data.interState ? (
        <Line label={t('gst.igst')} value={formatMoney(data.igst)} />
      ) : (
        <>
          <Line label={t('gst.cgst')} value={formatMoney(data.cgst)} />
          <Line label={t('gst.sgst')} value={formatMoney(data.sgst)} />
        </>
      )}
      <Line label={t('gst.invoiceTotal')} value={formatMoney(data.total)} bold />
      <Text variant="caption">{t('gst.placeOfSupply', {place: data.placeOfSupply})}</Text>
    </>
  );
}

function Line({label, value, bold}: {label: string; value: string; bold?: boolean}) {
  return (
    <View className="flex-row justify-between">
      <Text className={`text-sm ${bold ? 'font-bold' : ''} text-slate-900`}>{label}</Text>
      <Text className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} text-slate-900`}>{value}</Text>
    </View>
  );
}
