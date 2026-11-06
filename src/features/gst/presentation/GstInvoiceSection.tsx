import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {View} from 'react-native';

import {FilterChip} from '@components/filters';
import {FormField, TextField} from '@components/form';
import {SegmentedControl, Select, Text} from '@components/ui';
import {INDIAN_STATES, type IndianState} from '@config/constants';
import {gstRemote} from '@features/gst/data/gst.remote';
import {GST_RATES, cleanGstin, isValidGstin, type GstField} from '@features/gst/domain/gst';
import {formatMoney} from '@features/reconciliation/domain/money';
import {useT} from '@/i18n';
import {useDebouncedValue} from '@/shared/hooks/useDebouncedValue';

export interface GstForm {
  rate: string;
  hsn: string;
  priceIncludesGst: boolean;
  customerGstin: string;
  /** Only used when the customer has no GSTIN. */
  placeOfSupply: IndianState | null;
}

export const emptyGstForm = (customerGstin?: string): GstForm => ({
  rate: '18',
  hsn: '',
  priceIncludesGst: false,
  customerGstin: customerGstin ?? '',
  placeOfSupply: null,
});

/**
 * GST fields for a sale, with a live tax split that comes from the server's
 * calculation (POST /gst/preview) — the app never computes tax itself.
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

  return (
    <View className="rounded-2xl border border-border bg-white p-4" style={{gap: 16}}>
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
        {!online ? (
          <Text variant="caption">{t('gst.previewOffline')}</Text>
        ) : !ready ? (
          <Text variant="caption">{t('gst.previewHint')}</Text>
        ) : preview.isError ? (
          <Text className="text-sm text-danger">{(preview.error as Error).message}</Text>
        ) : !preview.data ? (
          <Text variant="caption">{t('gst.previewLoading')}</Text>
        ) : (
          <>
            <Line label={t('gst.taxableValue')} value={formatMoney(preview.data.taxableValue)} />
            {preview.data.interState ? (
              <Line label={t('gst.igst')} value={formatMoney(preview.data.igst)} />
            ) : (
              <>
                <Line label={t('gst.cgst')} value={formatMoney(preview.data.cgst)} />
                <Line label={t('gst.sgst')} value={formatMoney(preview.data.sgst)} />
              </>
            )}
            <Line label={t('gst.invoiceTotal')} value={formatMoney(preview.data.total)} bold />
            <Text variant="caption">{t('gst.placeOfSupply', {place: preview.data.placeOfSupply})}</Text>
          </>
        )}
      </View>
    </View>
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
