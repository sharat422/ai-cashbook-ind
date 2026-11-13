import {useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {Button, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {statementsRemote} from '@features/customers/data/statements.remote';
import {PdfShareSheet} from '@features/customers/presentation/components/PdfShareSheet';
import {sharePdf, type PdfChannel} from '@features/customers/presentation/sharePdf';
import {schemesRemote, type Bill} from '@features/schemes/data/schemes.remote';

import {formatMoney} from '@features/reconciliation/domain/money';
import {formatQty} from '@features/stock/domain/qty';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate} from '@utils/date';

type BillLineView = Bill['lines'][number];

/**
 * A saved item bill. The owner can cancel it or return some lines — always by
 * a reversal bill (goods back, the retailer owes less), never by editing it.
 */
export function BillDetailScreen({route}: AppScreenProps<'BillDetail'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const queryClient = useQueryClient();
  const bill = useQuery<Bill>({queryKey: ['bill', route.params.billId], queryFn: () => schemesRemote.getBill(route.params.billId)});
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const consent = useQuery({queryKey: ['statement-consent', bill.data?.customerId],
    queryFn: () => statementsRemote.consent(bill.data!.customerId), enabled: !!bill.data});
  const optedIn = consent.data?.status === 'opted_in';
  const [choosing, setChoosing] = useState(false);
  // The statements' one door (sharePdf): consent for WhatsApp / other apps, a log line always.
  const shareBill = async (b: Bill, channel: PdfChannel) => {
    setBusy(true);
    try {
      await sharePdf({kind: 'bill', bill: b}, channel);
    } catch (e) {
      if (!/cancel|did not share|dismiss/i.test(e instanceof Error ? e.message : String(e))) {
        Alert.alert(t('bill.shareFailed'), e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (bill.isLoading) {
    return <Screen><Skeleton className="mt-6 h-24 w-full" /></Screen>;
  }
  if (bill.isError || !bill.data) {
    return <Screen><ErrorState onRetry={() => bill.refetch()} retrying={bill.isFetching} /></Screen>;
  }
  const b = bill.data;
  const open = b.lines.filter((ln: BillLineView) => !ln.returned);
  const canReturn = can(PERMISSIONS.ENTRY_EDIT) && !b.reversesId && open.length > 0;

  const run = (itemIds: string[]) =>
    Alert.alert(itemIds.length ? t('bill.returnTitle') : t('bill.cancelTitle'),
      itemIds.length ? t('bill.returnMsg', {count: itemIds.length}) : t('bill.cancelMsg', {number: b.billNumber}), [
        {text: t('common.cancel'), style: 'cancel'},
        {text: itemIds.length ? t('bill.returnLines') : t('bill.cancelBill'), style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            await schemesRemote.cancelBill(b.id, itemIds);
            setPicking(false);
            setPicked([]);
            await queryClient.invalidateQueries();
          } catch (e) {
            Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }},
      ]);

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={{paddingVertical: 24, paddingBottom: 40, gap: 10}}>
        <Text variant="title">{t('bill.detailTitle', {number: b.billNumber})}</Text>
        <Text variant="caption">{formatDisplayDate(b.date)}</Text>
        {b.status || b.reversesId ? (
          <Text testID="bill-status" className="text-sm font-semibold text-red-700">
            {b.reversesId ? t('bill.isReturn') : b.status === 'cancelled' ? t('bill.statusCancelled') : t('bill.statusPartly')}
          </Text>
        ) : null}
        {b.lines.map((ln: BillLineView) => (
          <View key={ln.itemId} className="flex-row items-center justify-between rounded-xl bg-white p-3">
            <View className="flex-1">
              <Text className={`text-sm font-semibold ${ln.returned ? 'text-muted line-through' : ''}`}>{ln.name}</Text>
              <Text variant="caption">
                {formatQty(ln.quantity, ln.unit)} × {formatMoney(ln.rate)}{ln.returned ? ` · ${t('bill.returned')}` : ''}
              </Text>
              {ln.rateChanged ? (
                <Text testID={`rate-changed-${ln.itemId}`} className="text-xs font-semibold text-amber-700">{t('bill.rateChanged')}</Text>
              ) : null}
            </View>
            {picking && !ln.returned ? (
              <FilterChip testID={`return-${ln.itemId}`} label={t('bill.returnThis')} selected={picked.includes(ln.itemId)}
                onPress={() => setPicked(p => (p.includes(ln.itemId) ? p.filter(x => x !== ln.itemId) : [...p, ln.itemId]))} />
            ) : (
              <Text className="text-sm font-semibold">{formatMoney(ln.amount)}</Text>
            )}
          </View>
        ))}
        <Text className="text-right text-base font-bold">{t('bill.total')}: {formatMoney(b.total)}</Text>
        {(b.reversals ?? []).map((r: NonNullable<Bill['reversals']>[number]) => (
          <Text key={r.id} testID={`reversal-${r.id}`} variant="caption">
            ↩ {t('bill.reversalLine', {number: r.billNumber, date: formatDisplayDate(r.date), amount: formatMoney(r.total)})}
          </Text>
        ))}
        <Button testID="bill-share" title={t('bill.sharePdf')} variant="secondary" disabled={busy}
          onPress={() => setChoosing(true)} />
        <PdfShareSheet visible={choosing} onClose={() => setChoosing(false)}
          optedIn={consent.data ? optedIn : undefined} onPick={channel => shareBill(b, channel)} />
        {canReturn ? (
          picking ? (
            <>
              <Button testID="return-confirm" title={t('bill.returnLines')} disabled={!picked.length || busy}
                onPress={() => run(picked)} />
              <Button title={t('common.cancel')} variant="ghost" onPress={() => { setPicking(false); setPicked([]); }} />
            </>
          ) : (
            <View className="flex-row" style={{gap: 8}}>
              <Button testID="bill-return" title={t('bill.returnLines')} variant="secondary" className="flex-1"
                disabled={busy} onPress={() => setPicking(true)} />
              <Button testID="bill-cancel" title={t('bill.cancelBill')} variant="ghost" className="flex-1"
                disabled={busy} onPress={() => run([])} />
            </View>
          )
        ) : null}
      </ScrollView>
    </Screen>
  );
}
