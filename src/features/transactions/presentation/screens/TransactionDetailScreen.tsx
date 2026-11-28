import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Image, Linking, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {expenseRemote} from '@features/expense/data/expense.remote';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {incomeRemote} from '@features/income/data/income.remote';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';
import {useT} from '@/i18n';
import {categoryLabel} from '@/i18n/labels';

/**
 * One income or expense: opened by tapping it in Recent activity or Transaction
 * history. Shows everything that was saved, including the full notes and the
 * attached bill photo (a PDF opens in the phone's viewer). The owner can edit or
 * delete a synced income or expense; the server logs the change. A stock
 * purchase's expense is cancelled by reversing the purchase in Stock instead.
 */
export function TransactionDetailScreen({navigation, route}: AppScreenProps<'TransactionDetail'>): React.JSX.Element {
  const t = useT();
  const e = route.params.entry;
  const income = e.kind === 'income';
  const file = e.attachmentUri ?? e.attachmentUrl;
  const isPdf = !!file && /\.pdf(\?|$)/i.test(file);
  const {can} = usePermissions();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const id = (e.syncStatus ?? 'synced') === 'synced' && !e.purchase ? e.id : undefined;

  const remove = async (entryId: string) => {
    setDeleting(true);
    try {
      if (income) {
        await incomeRemote.remove(entryId);
        useIncomeStore.getState().removeEntry(entryId);
      } else {
        await expenseRemote.remove(entryId);
        useExpenseStore.getState().removeEntry(entryId);
      }
      await queryClient.invalidateQueries(); // out of Reports, Dashboard and history at once
      navigation.goBack();
    } catch (err) {
      setDeleting(false);
      Alert.alert(t('income.couldNotDelete'), err instanceof Error ? err.message : t('common.tryAgainMsg'));
    }
  };
  const confirmDelete = (entryId: string) =>
    Alert.alert(t(income ? 'income.deleteTitle' : 'expense.deleteTitle'),
      t(income ? 'income.deleteMsg' : 'expense.deleteMsg', {amount: formatINR(e.amount), date: formatDisplayDate(e.date)}), [
        {text: t('common.cancel'), style: 'cancel'},
        {text: t('common.delete'), style: 'destructive', onPress: () => void remove(entryId)},
      ]);
  const openEdit = (entryId: string) =>
    income ? navigation.navigate('AddIncome', {edit: {...e, id: entryId}})
      : navigation.navigate('AddExpense', {edit: {...e, id: entryId}});

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
        {id && (can(PERMISSIONS.ENTRY_EDIT) || can(PERMISSIONS.ENTRY_DELETE)) ? (
          <View className="flex-row" style={{gap: 12}}>
            {can(PERMISSIONS.ENTRY_EDIT) ? (
              <Button testID="tx-edit" title={t('txDetail.edit')} variant="secondary" className="flex-1" fullWidth={false}
                disabled={deleting} onPress={() => openEdit(id)} />
            ) : null}
            {can(PERMISSIONS.ENTRY_DELETE) ? (
              <Button testID="tx-delete" title={t('common.delete')} variant="secondary" className="flex-1" fullWidth={false}
                loading={deleting} onPress={() => confirmDelete(id)} />
            ) : null}
          </View>
        ) : null}
        {e.purchase ? <Text testID="tx-purchase-hint" variant="caption">{t('expense.purchaseHint')}</Text> : null}
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
