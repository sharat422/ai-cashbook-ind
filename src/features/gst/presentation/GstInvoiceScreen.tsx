import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, ScrollView, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {statementsRemote} from '@features/customers/data/statements.remote';
import type {SavedGstLine} from '@features/customers/domain/ledger';
import {PdfShareSheet} from '@features/customers/presentation/components/PdfShareSheet';
import {sharePdf, type PdfChannel} from '@features/customers/presentation/sharePdf';
import {GST_STATE_CODES} from '@features/gst/domain/gstSplit';
import {formatMoney} from '@features/reconciliation/domain/money';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {formatDisplayDate} from '@utils/date';

const STATE_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(GST_STATE_CODES).map(([name, code]) => [code, name]));

/**
 * A saved GST invoice as the server worked it out: seller and buyer with
 * GSTINs, place of supply, each item's tax, the totals; Share sends the
 * server-made PDF through the statements' one door (consent for WhatsApp, a
 * log line always). Nothing here recalculates tax.
 */
export function GstInvoiceScreen({route}: AppScreenProps<'GstInvoice'>): React.JSX.Element {
  const t = useT();
  const {customer, entry} = route.params;
  const business = useAuthStore(s => s.business);
  const gst = entry.gst;
  const consent = useQuery({queryKey: ['statement-consent', customer.id],
    queryFn: () => statementsRemote.consent(customer.id)});
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const share = async (channel: PdfChannel) => {
    setBusy(true);
    try {
      await sharePdf({kind: 'invoice', customer, entryId: entry.id, invoiceNumber: entry.invoiceNumber ?? ''}, channel);
    } catch (e) {
      if (!/cancel|did not share|dismiss/i.test(e instanceof Error ? e.message : String(e))) {
        Alert.alert(t('gst.shareFailed'), e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!gst) return <Screen><Text className="mt-6">{t('gst.notAnInvoice')}</Text></Screen>;
  const place = gst.placeOfSupply ? `${gst.placeOfSupply}-${STATE_BY_CODE[gst.placeOfSupply] ?? ''}` : '—';
  const totals: Array<[string, string, boolean?]> = [
    [t('gst.taxableValue'), gst.taxableValue], [t('gst.cgst'), gst.cgst], [t('gst.sgst'), gst.sgst],
    [t('gst.igst'), gst.igst], [t('gst.invoiceTotal'), entry.amount.toFixed(2), true],
  ];

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}>
        <Text variant="title">{t('gst.taxInvoice')}</Text>
        {entry.gstStatus === 'cancelled' ? (
          <Text testID="invoice-cancelled" className="mt-1 font-semibold text-red-600">{t('gst.invoiceCancelled')}</Text>
        ) : null}
        <Text variant="subtitle" className="mt-1">
          {t('gst.invoiceNoDate', {number: entry.invoiceNumber ?? '', date: formatDisplayDate(entry.date)})}
        </Text>

        <View className="mt-5 rounded-2xl border border-border bg-white p-4" style={{gap: 4}}>
          <Text className="text-sm font-semibold">{business?.businessName}</Text>
          {business?.address ? <Text variant="caption">{business.address}</Text> : null}
          <Text variant="caption">GSTIN {business?.gstin ?? '—'} · {business?.state}</Text>
          <Text className="mt-3 text-sm font-semibold">{t('gst.billTo', {name: customer.fullName})}</Text>
          <Text variant="caption">GSTIN {gst.customerGstin ?? t('gst.unregistered')}</Text>
          <Text variant="caption">{t('gst.placeOfSupply', {place})}</Text>
        </View>

        <View className="mt-3" style={{gap: 8}}>
          {gst.lines.map((ln: SavedGstLine, i: number) => (
            <View key={i} testID="invoice-line" className="rounded-2xl border border-border bg-white p-3" style={{gap: 2}}>
              <Text className="text-sm font-semibold">{ln.itemName ? `${ln.itemName} · ${ln.hsn}` : `HSN ${ln.hsn}`}</Text>
              <Text variant="caption">
                {[ln.quantity ? `${ln.quantity} ${ln.uqc ?? ''}`.trim() : '', `${ln.rate}%`].filter(Boolean).join(' · ')}
              </Text>
              <Text variant="caption">
                {t('gst.taxableValue')} {formatMoney(ln.taxableValue)}
                {Number(ln.igst) ? ` · ${t('gst.igst')} ${formatMoney(ln.igst)}`
                  : ` · ${t('gst.cgst')} ${formatMoney(ln.cgst)} · ${t('gst.sgst')} ${formatMoney(ln.sgst)}`}
              </Text>
            </View>
          ))}
        </View>

        <View testID="invoice-totals" className="mt-3 rounded-2xl bg-slate-50 p-4" style={{gap: 6}}>
          {totals.map(([label, value, bold]) => (
            <View key={label} className="flex-row justify-between">
              <Text className={`text-sm ${bold ? 'font-bold' : ''}`}>{label}</Text>
              <Text className={`text-sm ${bold ? 'font-bold' : 'font-semibold'}`}>{formatMoney(value)}</Text>
            </View>
          ))}
        </View>
        <Text variant="caption" className="mt-2">{t('gst.notEInvoice')}</Text>

        <Button testID="invoice-share" title={t('gst.sharePdf')} className="mt-5" loading={busy} disabled={busy}
          onPress={() => setChoosing(true)} />
        <PdfShareSheet visible={choosing} onClose={() => setChoosing(false)} onPick={share}
          optedIn={consent.data ? consent.data.status === 'opted_in' : undefined} />
      </ScrollView>
    </Screen>
  );
}
