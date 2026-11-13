import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {NetworkError} from '@api/client';
import {Button, Screen, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {useVisitQueue} from '@features/beats/data/visitQueue';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useConnectivity} from '@features/income/presentation/hooks/useConnectivity';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useStockQueue} from '@features/stock/data/stockQueue';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {useCustomerEdits} from '../customerEdits';
import {discardQueued, requeueEdited, type Fix, type MoneyKind, type QueueKind} from '../failedEntries';
import {EditQueuedSheet} from './EditQueuedSheet';
import {syncEverything, syncState, useSyncCounts} from '../syncStatus';

interface Item {
  key: string;
  what: string;
  detail: string;
  error?: string;
  /** Queued by the quick check before saving: the signal was too weak (IM2). */
  weak?: boolean;
  /** IM5: which queue, its client id and amount — so a failed entry can be discarded. */
  kind?: QueueKind;
  amount?: number | null;
  /** A money entry: the fields Edit can fix. */
  fix?: {kind: MoneyKind; values: Fix; referenceLabel?: TKey};
}

const SHOW = 50;

/** Everything still on this phone: waiting, refused by the server, or in conflict. */
export function SyncStatusScreen({navigation}: AppScreenProps<'SyncStatus'>): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const canDiscard = usePermissions().can(PERMISSIONS.ENTRY_DELETE); // owner only (the server checks too)
  const [editing, setEditing] = useState<Item | null>(null);
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
  const stock = useStockQueue(s => s.pending);
  const stockConflicts = useStockQueue(s => s.conflicts);

  const items: Item[] = [
    ...income.map(q => ({key: q.localId, what: t('sync.kind.income'), detail: formatINR(q.draft.amount), error: q.lastError, weak: q.weakSignal,
      kind: 'income' as const, amount: q.draft.amount,
      fix: {kind: 'income' as const, values: {amount: q.draft.amount, date: q.draft.date, notes: q.draft.notes}}})),
    ...expense.map(q => ({key: q.localId, what: t('sync.kind.expense'), detail: formatINR(q.draft.amount), error: q.lastError,
      kind: 'expense' as const, amount: q.draft.amount,
      fix: {kind: 'expense' as const, values: {amount: q.draft.amount, date: q.draft.date, notes: q.draft.notes}}})),
    ...ledger.map(q => ({
      key: q.localId,
      what: q.draft.type === 'credit' ? t('ledger.creditGiven') : t('ledger.paymentReceived'),
      detail: `${names[q.customerId]?.fullName ?? ''} ${formatINR(q.draft.amount)}`.trim(),
      error: q.lastError,
      weak: q.weakSignal,
      kind: 'ledger' as const,
      amount: q.draft.amount,
      fix: {kind: 'ledger' as const, referenceLabel: (q.draft.type === 'credit' ? 'customers.invoiceNumber' : 'payments.reference') as TKey,
        values: {amount: q.draft.amount, date: q.draft.date, notes: q.draft.notes,
          reference: q.draft.type === 'credit' ? q.draft.invoiceNumber : q.draft.referenceNumber}},
    })),
    ...visits.map(q => ({
      key: q.clientId,
      what: t('sync.kind.visit'),
      detail: t(`beats.outcome.${q.outcome}` as TKey),
      error: q.lastError,
      weak: q.weakSignal,
      kind: 'visit' as const,
      amount: null,
    })),
    ...edits.map(q => ({key: `edit-${q.customerId}`, what: t('sync.kind.customerEdit'), detail: q.draft.fullName, error: q.lastError, weak: q.weakSignal})),
    ...stock.map(q => ({
      key: q.input.clientId,
      what: q.op === 'bill' ? t('sync.kind.bill') : t('sync.kind.stock'),
      detail: q.op === 'bill'
        ? `${q.itemName} · ${t('bill.queuedLines', {count: q.input.lines.length})}`
        : `${q.op === 'transfer' ? t('stock.action.transfer') : t(`stock.kind.${q.input.kind}` as TKey)} · ${q.itemName} · ${q.input.quantity}`,
      error: q.lastError,
      weak: q.weakSignal,
      kind: q.op === 'bill' ? 'bill' as const : 'stock' as const,
      amount: null,
    })),
  ];

  /** IM5: a failed money entry, fixed in place (same client id), synced again now. */
  const saveEdit = async (fix: Fix) => {
    if (!editing?.fix) return;
    requeueEdited(editing.fix.kind, editing.key, fix);
    setEditing(null);
    await syncNow();
  };

  /** IM5, owner only: confirm naming the entry and its amount; the server records it first. */
  const confirmDiscard = (i: Item) => {
    const amount = i.amount != null ? formatINR(i.amount) : null;
    Alert.alert(t('sync.discardTitle'), t('sync.discardMsg', {entry: `${i.what} · ${i.detail}`}), [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: amount ? t('sync.discardAmount', {amount}) : t('sync.discard'),
        style: 'destructive',
        onPress: async () => {
          try {
            await discardQueued(i.kind!, i.key, i.amount ?? null, `${i.what} · ${i.detail}`);
          } catch (err) {
            Alert.alert(err instanceof NetworkError ? t('sync.discardNeedsConnection') : (err as Error).message);
          }
        },
      },
    ]);
  };

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

        {stockConflicts.length > 0 ? (
          <>
            <Text variant="label" className="mb-2 mt-7">{t('stock.conflictsHeading')}</Text>
            {stockConflicts.map(c => (
              <Pressable
                key={c.entry.input.clientId}
                testID={`stock-conflict-${c.entry.input.clientId}`}
                accessibilityRole="button"
                onPress={() => navigation.navigate('StockConflict', {clientId: c.entry.input.clientId})}
                className="mb-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
                <Text className="text-sm font-semibold text-violet-900">{c.entry.itemName}</Text>
                <Text variant="caption">
                  {c.entry.op === 'bill' ? t('bill.conflictTap') : t('stock.conflictTap', {queued: c.queued, current: c.current})}
                </Text>
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
                    {i.error ? t('sync.failed') : i.weak ? t('sync.queuedWeakSignal') : t('sync.pending')}
                  </Text>
                </View>
                <Text variant="caption">{i.detail}</Text>
                {i.error ? <Text className="mt-1 text-xs text-red-700">{i.error}</Text> : null}
                {i.error && (i.fix || (canDiscard && i.kind)) ? (
                  <View className="mt-2 flex-row" style={{gap: 8}}>
                    {i.fix ? (
                      <Button testID={`sync-edit-${i.key}`} title={t('sync.edit')} variant="secondary"
                        fullWidth={false} onPress={() => setEditing(i)} />
                    ) : null}
                    {canDiscard && i.kind ? (
                      <Button testID={`sync-discard-${i.key}`} title={t('sync.discard')} variant="ghost"
                        fullWidth={false} onPress={() => confirmDiscard(i)} />
                    ) : null}
                  </View>
                ) : null}
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
      <EditQueuedSheet fix={editing?.fix?.values ?? null} referenceLabel={editing?.fix?.referenceLabel}
        onClose={() => setEditing(null)} onSave={fix => void saveEdit(fix)} />
    </Screen>
  );
}
