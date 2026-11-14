import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {View} from 'react-native';

import {FilterChip} from '@components/filters';
import {FormField, TextField} from '@components/form';
import {Button, SegmentedControl, Select, Text} from '@components/ui';
import {INDIAN_STATES, type IndianState} from '@config/constants';
import {gstRemote} from '@features/gst/data/gst.remote';
import {UQC_CODES, cleanGstin, gstRatesFor, isValidGstin, uqcForUnit, type GstField} from '@features/gst/domain/gst';
import type {Item} from '@features/items/domain/entities';
import {useItems} from '@features/items/presentation/hooks/useItems';
import {formatMoney} from '@features/reconciliation/domain/money';
import {GST_STATE_CODES, gstSplitLines, placeOfSupply} from '@features/gst/domain/gstSplit';
import {useAuthStore} from '@store/auth.store';
import {useT} from '@/i18n';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';

/** One item's fields. Item 1's amount is the screen's big amount field. */
export interface GstLineForm {
  itemId: string | null;
  hsn: string;
  quantity: string;
  uqc: string | null;
  rate: string;
}

/** Item 2, 3…: their own amount, and whether it came from the item's price × quantity. */
export interface GstExtraLine extends GstLineForm {
  amount: string;
  fromItem?: boolean;
}

export interface GstForm extends GstLineForm {
  priceIncludesGst: boolean;
  customerGstin: string;
  /** Only used when the customer has no GSTIN. */
  placeOfSupply: IndianState | null;
  /** A cash sale: paid in full now, so it's never owed. */
  paidNow?: boolean;
  /** Items after the first (a GST invoice with several items). */
  extra?: GstExtraLine[];
}

const emptyLine = (): GstLineForm => ({rate: '18', hsn: '', quantity: '', uqc: null, itemId: null});

export const emptyGstForm = (customerGstin?: string): GstForm => ({
  ...emptyLine(),
  priceIncludesGst: false,
  customerGstin: customerGstin ?? '',
  placeOfSupply: null,
});

/**
 * The line amount from the item's sale price × quantity, or null when the
 * item has no sale price (0 = none stored) or there's no quantity yet —
 * never an invented 0.
 */
export function itemAmount(salePrice: number | undefined, quantity: string): number | null {
  const q = Number(quantity);
  if (!salePrice || salePrice <= 0 || !Number.isFinite(q) || q <= 0) return null;
  return Math.round(salePrice * q * 100) / 100;
}

/**
 * GST fields for a sale, with a live tax split that comes from the server's
 * calculation (POST /gst/preview); offline, the same formula on the phone (gstSplit.ts).
 * Several items: each is taxed on its own and the split shown is their sum.
 */
export function GstInvoiceSection({
  value,
  onChange,
  amount,
  onItemAmount,
  online,
  errorField,
  error,
  errorLine,
}: {
  value: GstForm;
  onChange: (next: GstForm) => void;
  /** Item 1's amount (the screen's amount field). */
  amount: number;
  /** The amount from the item's price × quantity (the screen ignores it once the owner typed one). */
  onItemAmount?: (amount: number) => void;
  online: boolean;
  errorField?: GstField | null;
  error?: string | null;
  /** Which extra item (0 = item 2) the error is about; undefined = item 1 or the invoice. */
  errorLine?: number;
}): React.JSX.Element {
  const t = useT();
  const set = (patch: Partial<GstForm>) => onChange({...value, ...patch});
  const extra = value.extra ?? [];
  const gstin = cleanGstin(value.customerGstin);
  const input = useDebouncedValue({
    lines: [{amount, rate: value.rate}, ...extra.map(l => ({amount: Number(l.amount), rate: l.rate}))],
    priceIncludesGst: value.priceIncludesGst,
    customerGstin: gstin || undefined,
    placeOfSupply: gstin ? undefined : value.placeOfSupply ?? undefined,
  });
  const ready = input.lines.every(l => Number.isFinite(l.amount) && l.amount > 0) &&
    (!input.customerGstin || isValidGstin(input.customerGstin));
  const preview = useQuery({
    queryKey: ['gst-preview', input],
    queryFn: () => gstRemote.preview({
      amount: input.lines[0].amount,
      rate: input.lines[0].rate,
      lines: input.lines.length > 1 ? input.lines : undefined,
      priceIncludesGst: input.priceIncludesGst,
      customerGstin: input.customerGstin,
      placeOfSupply: input.placeOfSupply,
    }),
    enabled: online && ready,
    retry: false,
  });
  // Offline: the same formula as the server, on the phone (gstSplit.ts).
  const sellerGstin = useAuthStore(s => s.business?.gstin ?? '');
  const local = !online && sellerGstin && ready
    ? (() => {
        const pos = placeOfSupply(sellerGstin, input.customerGstin, input.placeOfSupply);
        const inter = pos !== sellerGstin.slice(0, 2);
        const name = Object.keys(GST_STATE_CODES).find(k => GST_STATE_CODES[k] === pos) ?? '';
        return {...gstSplitLines(input.lines, input.priceIncludesGst, inter),
          interState: inter, placeOfSupply: `${pos}-${name}`};
      })()
    : null;

  const items = useItems('');
  const products: Item[] = (items.data?.items ?? []).filter((i: Item) => i.type === 'product');
  const priceOf = (itemId: string | null) => products.find(i => i.id === itemId)?.salePrice;

  const setExtra = (i: number, next: GstLineForm, fromPrice: number | null) => {
    const old = extra[i];
    // The item's price × quantity fills the amount until the owner types their own.
    const useIt = fromPrice !== null && (old.fromItem || !old.amount);
    const line = {...old, ...next, ...(useIt ? {amount: String(fromPrice), fromItem: true} : {})};
    set({extra: extra.map((l, j) => (j === i ? line : l))});
  };

  return (
    <View className="rounded-2xl border border-border bg-white p-4" style={{gap: 16}}>
      {extra.length > 0 ? (
        <View>
          <Text className="text-sm font-semibold">{t('gst.itemN', {n: 1})}</Text>
          <Text variant="caption">{t('gst.firstItemAmount')}</Text>
        </View>
      ) : null}
      <LineFields
        value={value}
        products={products}
        onChange={(next, fromPrice) => {
          set(next);
          if (fromPrice !== null) onItemAmount?.(fromPrice);
        }}
        priceOf={priceOf}
        errorField={errorLine === undefined ? errorField : null}
        error={error}
      />

      {extra.map((line, i) => (
        <View key={i} testID={`gst-line-${i + 2}`} className="border-t border-border pt-4" style={{gap: 16}}>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold">{t('gst.itemN', {n: i + 2})}</Text>
            <Button testID={`gst-line-remove-${i + 2}`} title={t('gst.removeItem')} variant="ghost"
              onPress={() => set({extra: extra.filter((_, j) => j !== i)})} />
          </View>
          <LineFields
            value={line}
            products={products}
            onChange={(next, fromPrice) => setExtra(i, next, fromPrice)}
            priceOf={priceOf}
            errorField={errorLine === i ? errorField : null}
            error={error}
            testSuffix={`-${i + 2}`}
          />
          <FormField label={t('gst.lineAmount')} required error={errorLine === i && errorField === 'amount' ? error : null}>
            <TextField
              testID={`gst-amount-${i + 2}`}
              value={line.amount}
              onChangeText={v => set({extra: extra.map((l, j) =>
                (j === i ? {...l, amount: v.replace(/[^0-9.]/g, ''), fromItem: false} : l))})}
              placeholder="0"
              keyboardType="decimal-pad"
              maxLength={12}
              error={errorLine === i && errorField === 'amount' ? error : null}
            />
          </FormField>
          {line.fromItem ? <Text variant="caption">{t('gst.amountFromItem')}</Text> : null}
        </View>
      ))}
      <Button testID="gst-add-item" title={t('gst.addItem')} variant="secondary"
        onPress={() => set({extra: [...extra, {...emptyLine(), amount: ''}]})} />

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
      <SegmentedControl
        label={t('gst.priceIs')}
        value={value.priceIncludesGst}
        options={[
          {label: t('gst.excludes'), value: false},
          {label: t('gst.includes'), value: true},
        ]}
        onChange={v => set({priceIncludesGst: v})}
      />

      <SegmentedControl
        label={t('gst.paidNow')}
        value={!!value.paidNow}
        options={[
          {label: t('gst.paidLater'), value: false},
          {label: t('gst.paidCash'), value: true},
        ]}
        onChange={v => set({paidNow: v})}
      />
      {value.paidNow ? <Text variant="caption">{t('gst.paidNowHint')}</Text> : null}

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

/** One item: product, HSN, quantity and unit, rate. `onChange` gets the
 *  item's price × quantity when an item or quantity was just set, else null. */
function LineFields({value, onChange, products, priceOf, errorField, error, testSuffix = ''}: {
  value: GstLineForm;
  onChange: (next: GstLineForm, fromPrice: number | null) => void;
  products: Item[];
  priceOf: (itemId: string | null) => number | undefined;
  errorField?: GstField | null;
  error?: string | null;
  testSuffix?: string;
}): React.JSX.Element {
  const t = useT();
  const set = (patch: Partial<GstLineForm>) => onChange({...value, ...patch}, null);
  const pickItem = (id: string) => {
    const item = products.find(i => i.id === id);
    if (!item) return;
    const rate = String(item.gstRate);
    const hsn = (item.hsnSac ?? '').replace(/\D/g, '') || value.hsn;
    onChange({
      ...value,
      itemId: id,
      hsn,
      rate: gstRatesFor(hsn).includes(rate) ? rate : value.rate, // an ended rate isn't copied
      uqc: uqcForUnit(item.unit) ?? value.uqc,
    }, itemAmount(priceOf(id), value.quantity));
  };
  return (
    <>
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
      <FormField label={t('gst.hsn')} required error={errorField === 'hsn' ? error : null}>
        <TextField
          testID={`gst-hsn${testSuffix}`}
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
              testID={`gst-quantity${testSuffix}`}
              value={value.quantity}
              onChangeText={v => {
                const quantity = v.replace(/[^0-9.]/g, '');
                onChange({...value, quantity}, itemAmount(priceOf(value.itemId), quantity));
              }}
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
          {gstRatesFor(value.hsn).map(r => (
            <FilterChip key={r} label={`${r}%`} selected={value.rate === r} onPress={() => set({rate: r})} />
          ))}
        </View>
      </FormField>
    </>
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
