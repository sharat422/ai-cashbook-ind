import React from 'react';
import {Image, Linking, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';
import {useT} from '@/i18n';
import {categoryLabel} from '@/i18n/labels';

/**
 * One income or expense, read-only: opened by tapping it in Recent activity or
 * Transaction history. Shows everything that was saved, including the full
 * notes and the attached bill photo (a PDF opens in the phone's viewer).
 */
export function TransactionDetailScreen({route}: AppScreenProps<'TransactionDetail'>): React.JSX.Element {
  const t = useT();
  const e = route.params.entry;
  const income = e.kind === 'income';
  const file = e.attachmentUri ?? e.attachmentUrl;
  const isPdf = !!file && /\.pdf(\?|$)/i.test(file);

  return (
    <Screen>
      <View className="py-6" style={{gap: 16}}>
        <Text variant="title">{t('txDetail.title')}</Text>
        <Text testID="tx-amount" className={`text-3xl font-bold ${income ? 'text-success' : 'text-danger'}`}>
          {income ? '+' : '−'}
          {formatINR(e.amount)}
        </Text>
        <View className="rounded-2xl border border-border bg-white px-4">
          <Row label={t('txDetail.type')} value={income ? t('txn.typeIncome') : t('txn.typeExpense')} first />
          <Row label={t('form.category')} value={categoryLabel(t, e.category)} />
          {!income && e.vendor ? <Row label={t('expense.vendorLabel')} value={e.vendor} /> : null}
          <Row label={t('form.date')} value={formatDisplayDate(e.date)} />
          {e.syncStatus && e.syncStatus !== 'synced' ? (
            <Row label={t('txDetail.status')} value={e.syncStatus === 'pending' ? t('sync.pending') : t('sync.failed')} />
          ) : null}
        </View>
        {e.notes ? (
          <View className="rounded-2xl border border-border bg-white p-4">
            <Text variant="label" className="mb-1">{t('form.notes')}</Text>
            <Text selectable testID="tx-notes" className="text-base text-slate-900">{e.notes}</Text>
          </View>
        ) : null}
        {file ? (
          <View className="rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
            <Text variant="label">{t('form.attachment')}</Text>
            {isPdf ? (
              <Button title={t('txDetail.openFile')} variant="secondary"
                onPress={() => void Linking.openURL(file).catch(() => undefined)} />
            ) : (
              <Image testID="tx-photo" source={{uri: file}} resizeMode="contain"
                style={{width: '100%', height: 320}} accessibilityLabel={t('form.attachment')} />
            )}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function Row({label, value, first}: {label: string; value: string; first?: boolean}): React.JSX.Element {
  return (
    <View className={`flex-row justify-between py-3 ${first ? '' : 'border-t border-border'}`} style={{gap: 12}}>
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="flex-1 text-right text-sm font-semibold text-slate-900">{value}</Text>
    </View>
  );
}
