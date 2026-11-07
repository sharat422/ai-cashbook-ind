import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {useVisitQueue} from '@features/beats/data/visitQueue';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useConnectivity} from '@features/income/presentation/hooks/useConnectivity';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {useCustomerEdits} from '../customerEdits';
import {syncEverything, syncState, useSyncCounts} from '../syncStatus';

interface Item {
  key: string;
  what: string;
  detail: string;
  error?: string;
}

const SHOW = 50;

/** Everything still on this phone: waiting, refused by the server, or in conflict. */
export function SyncStatusScreen({navigation}: AppScreenProps<'SyncStatus'>): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const online = useConnectivity();
  const counts = useSyncCounts();
  const [busy, setBusy] = useState(false);

  const income = useIncomeStore(s => s.queue);
  const expense = useExpenseStore(s => s.queue);
  const ledger = usePendingLedgerStore(s => s.entries);
  const names = usePendingLedgerStore(s => s.customers);
  const visits = useVisitQueue(s => s.pending);
  const edits = useCustomerEdits(s => s.pending);
  const conflicts = useCustomerEdits(s => s.conflicts);

  const items: Item[] = [
    ...income.map(q => ({key: q.localId, what: t('sync.kind.income'), detail: formatINR(q.draft.amount), error: q.lastError})),
    ...expense.map(q => ({key: q.localId, what: t('sync.kind.expense'), detail: formatINR(q.draft.amount), error: q.lastError})),
    ...ledger.map(q => ({
      key: q.localId,
      what: q.draft.type === 'credit' ? t('ledger.creditGiven') : t('ledger.paymentReceived'),
      detail: `${names[q.customerId]?.fullName ?? ''} ${formatINR(q.draft.amount)}`.trim(),
      error: q.lastError,
    })),
    ...visits.map(q => ({
      key: q.clientId,
      what: t('sync.kind.visit'),
      detail: t(`beats.outcome.${q.outcome}` as TKey),
      error: q.lastError,
    })),
    ...edits.map(q => ({key: `edit-${q.customerId}`, what: t('sync.kind.customerEdit'), detail: q.draft.fullName, error: q.lastError})),
  ];

  const syncNow = async () => {
    setBusy(true);
    try {
      await syncEverything();
      await queryClient.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };

  const state = syncState(counts);
  const tiles: {key: string; label: string; value: string; on: boolean}[] = [
    {key: 'synced', label: t('sync.tile.synced'), value: state === 'synced' ? '✓' : '—', on: state === 'synced'},
    {key: 'pending', label: t('sync.tile.pending'), value: String(counts.pending), on: counts.pending > 0},
    {key: 'failed', label: t('sync.tile.failed'), value: String(counts.failed), on: counts.failed > 0},
    {key: 'conflict', label: t('sync.tile.conflict'), value: String(counts.conflicts), on: counts.conflicts > 0},
  ];

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('sync.title')}</Text>
        <Text variant="subtitle" className="mt-1">
          {online ? t('sync.online') : t('sync.offlineLong')}
        </Text>

        <View className="mt-5 flex-row flex-wrap" style={{gap: 8}}>
          {tiles.map(tile => (
            <View
              key={tile.key}
              testID={`sync-tile-${tile.key}`}
              className={`min-w-[22%] flex-1 rounded-xl border p-3 ${tile.on ? 'border-primary bg-white' : 'border-border bg-slate-50'}`}>
              <Text className="text-lg font-bold">{tile.value}</Text>
              <Text variant="caption">{tile.label}</Text>
            </View>
          ))}
        </View>

        <Button testID="sync-now" title={t('sync.now')} className="mt-5" loading={busy} disabled={busy || !online} onPress={syncNow} />

        {conflicts.length > 0 ? (
          <>
            <Text variant="label" className="mb-2 mt-7">{t('sync.conflictsHeading')}</Text>
            {conflicts.map(c => (
              <Pressable
                key={c.customerId}
                testID={`conflict-${c.customerId}`}
                accessibilityRole="button"
                onPress={() => navigation.navigate('SyncConflict', {customerId: c.customerId})}
                className="mb-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
                <Text className="text-sm font-semibold text-violet-900">{c.theirs.fullName}</Text>
                <Text variant="caption">{t('sync.conflictTap')}</Text>
              </Pressable>
            ))}
          </>
        ) : null}

        {items.length > 0 ? (
          <>
            <Text variant="label" className="mb-2 mt-7">{t('sync.onThisPhone')}</Text>
            {items.slice(0, SHOW).map(i => (
              <View key={i.key} className="mb-2 rounded-xl border border-border bg-white p-3">
                <View className="flex-row justify-between">
                  <Text className="flex-1 text-sm font-semibold">{i.what}</Text>
                  <Text className={`text-xs font-semibold ${i.error ? 'text-red-700' : 'text-amber-700'}`}>
                    {i.error ? t('sync.failed') : t('sync.pending')}
                  </Text>
                </View>
                <Text variant="caption">{i.detail}</Text>
                {i.error ? <Text className="mt-1 text-xs text-red-700">{i.error}</Text> : null}
              </View>
            ))}
            {items.length > SHOW ? (
              <Text variant="caption">{t('sync.andMore', {count: items.length - SHOW})}</Text>
            ) : null}
          </>
        ) : state === 'synced' ? (
          <Text variant="caption" className="mt-7">{t('sync.allSyncedMsg')}</Text>
        ) : null}
      </View>
    </Screen>
  );
}
