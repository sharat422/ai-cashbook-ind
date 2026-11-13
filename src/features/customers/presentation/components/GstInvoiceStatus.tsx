import React from 'react';
import {Alert, View} from 'react-native';

import {Button, Text} from '@components/ui';
import type {LedgerEntry} from '@features/customers/domain/ledger';
import {useLedgerMutations} from '@features/customers/presentation/hooks/useLedgerMutations';
import {useT} from '@/i18n';

/**
 * Under a GST invoice on the timeline: a draft (no number yet) can be issued
 * or deleted; an issued invoice is locked, shows its number and can only be
 * cancelled (or corrected with a credit note); a cancelled one says so.
 */
export function GstInvoiceStatus({customerId, entry}: {customerId: string; entry: LedgerEntry}): React.JSX.Element | null {
  const t = useT();
  const {issueInvoice, cancelInvoice, deleteDraft} = useLedgerMutations(customerId);
  if (!entry.gstStatus || entry.syncStatus === 'pending') return null;
  const fail = (e: Error) => Alert.alert(t('form.couldNotSave'), e.message);
  const busy = issueInvoice.isPending || cancelInvoice.isPending || deleteDraft.isPending;

  if (entry.gstStatus === 'draft') {
    return (
      <View testID={`gst-draft-${entry.id}`} className="mt-1 rounded-xl bg-amber-50 p-3" style={{gap: 8}}>
        <Text className="text-sm font-semibold">{t('gst.draftLabel')}</Text>
        <Text variant="caption">{t('gst.draftHint')}</Text>
        <View className="flex-row" style={{gap: 8}}>
          <Button testID={`gst-issue-${entry.id}`} title={t('gst.issue')} className="flex-1" disabled={busy}
            onPress={() => Alert.alert(t('gst.issueTitle'), t('gst.issueMsg'), [
              {text: t('common.cancel'), style: 'cancel'},
              {text: t('gst.issue'), onPress: () => issueInvoice.mutate(entry.id, {onError: fail})},
            ])} />
          <Button testID={`gst-delete-${entry.id}`} title={t('gst.deleteDraft')} variant="ghost" className="flex-1"
            disabled={busy} onPress={() => deleteDraft.mutate(entry.id, {onError: fail})} />
        </View>
      </View>
    );
  }
  if (entry.gstStatus === 'cancelled') {
    return (
      <Text testID={`gst-cancelled-${entry.id}`} variant="caption" className="mt-1">
        {t('gst.cancelledLabel', {number: entry.invoiceNumber ?? ''})}
      </Text>
    );
  }
  return (
    <View testID={`gst-issued-${entry.id}`} className="mt-1 flex-row items-center justify-between" style={{gap: 8}}>
      <Text variant="caption" className="flex-1">🔒 {t('gst.issuedLabel', {number: entry.invoiceNumber ?? ''})}</Text>
      <Button testID={`gst-cancel-${entry.id}`} title={t('gst.cancelInvoice')} variant="ghost" disabled={busy}
        onPress={() => Alert.alert(t('gst.cancelTitle'), t('gst.cancelMsg', {number: entry.invoiceNumber ?? ''}), [
          {text: t('common.cancel'), style: 'cancel'},
          {text: t('gst.cancelInvoice'), style: 'destructive', onPress: () => cancelInvoice.mutate(entry.id, {onError: fail})},
        ])} />
    </View>
  );
}
