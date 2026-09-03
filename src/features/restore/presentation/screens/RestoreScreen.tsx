import {useQueryClient} from '@tanstack/react-query';
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {restoreRemote} from '@features/restore/data/restore.remote';
import type {RestoreProgress, RestoreSummary} from '@features/restore/domain/entities';
import {runRestore} from '@features/restore/domain/runRestore';
import {useRestoreStore} from '@features/restore/store/restore.store';
import {useT} from '@/i18n';
import {colors} from '@theme/colors';
import {useAuthStore} from '@store/auth.store';

type Phase = 'checking' | 'confirm' | 'restoring' | 'checkError' | 'restoreError';

/**
 * Explicit "restore your data" step shown once per account on a fresh device.
 * It checks the cloud for existing data, asks the user to confirm, then pulls it
 * down with a visible progress bar — so a returning user never silently lands on
 * an empty-looking app.
 */
export function RestoreScreen({onDone}: {onDone: () => void}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const businessId = useAuthStore(s => s.business?.id ?? null);
  const markDecided = useRestoreStore(s => s.markDecided);

  const [phase, setPhase] = useState<Phase>('checking');
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [progress, setProgress] = useState<RestoreProgress | null>(null);

  const finish = useCallback(
    (decision: 'restored' | 'skipped') => {
      if (businessId) markDecided(businessId, decision);
      onDone();
    },
    [businessId, markDecided, onDone],
  );

  const check = useCallback(async () => {
    setPhase('checking');
    try {
      const result = await restoreRemote.getSummary();
      // Nothing in the cloud (e.g. a brand-new business) → no prompt, just go.
      if (result.total === 0) return finish('restored');
      setSummary(result);
      setPhase('confirm');
    } catch {
      setPhase('checkError');
    }
  }, [finish]);

  useEffect(() => {
    void check();
  }, [check]);

  const startRestore = async () => {
    setPhase('restoring');
    setProgress({completed: 0, total: 1, labelKey: 'restore.stepIncome'});
    try {
      await runRestore({queryClient, onProgress: setProgress});
      finish('restored');
    } catch {
      setPhase('restoreError');
    }
  };

  // --- Checking ------------------------------------------------------------
  if (phase === 'checking') {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8" style={{gap: 16}}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="subtitle">{t('restore.checking')}</Text>
        </View>
      </Screen>
    );
  }

  // --- Check failed --------------------------------------------------------
  if (phase === 'checkError') {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8" style={{gap: 12}}>
          <Text className="text-5xl">📡</Text>
          <Text variant="title" className="text-center">
            {t('restore.checkErrorTitle')}
          </Text>
          <Text variant="subtitle" className="text-center">
            {t('restore.checkErrorMsg')}
          </Text>
          <View className="mt-4 w-full" style={{gap: 8}}>
            <Button title={t('common.retry')} onPress={() => void check()} />
            <Button
              title={t('restore.continueAnyway')}
              variant="ghost"
              onPress={() => finish('skipped')}
            />
          </View>
        </View>
      </Screen>
    );
  }

  // --- Restoring (progress) ------------------------------------------------
  if (phase === 'restoring') {
    const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0;
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8" style={{gap: 16}}>
          <Text className="text-5xl">☁️</Text>
          <Text variant="title" className="text-center">
            {t('restore.restoringTitle')}
          </Text>
          <View className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200">
            <View
              className="h-3 rounded-full bg-primary"
              style={{width: `${Math.max(5, pct)}%`}}
            />
          </View>
          <Text variant="caption">
            {progress ? t(progress.labelKey) : ''} · {pct}%
          </Text>
        </View>
      </Screen>
    );
  }

  // --- Restore failed mid-way ---------------------------------------------
  if (phase === 'restoreError') {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8" style={{gap: 12}}>
          <Text className="text-5xl">⚠️</Text>
          <Text variant="title" className="text-center">
            {t('restore.restoreErrorTitle')}
          </Text>
          <Text variant="subtitle" className="text-center">
            {t('restore.restoreErrorMsg')}
          </Text>
          <View className="mt-4 w-full" style={{gap: 8}}>
            <Button title={t('common.retry')} onPress={() => void startRestore()} />
            <Button
              title={t('restore.continueAnyway')}
              variant="ghost"
              onPress={() => finish('skipped')}
            />
          </View>
        </View>
      </Screen>
    );
  }

  // --- Confirm -------------------------------------------------------------
  return (
    <Screen>
      <View className="flex-1 justify-center px-6">
        <Text className="text-center text-6xl">☁️</Text>
        <Text variant="title" className="mt-4 text-center">
          {t('restore.confirmTitle')}
        </Text>
        <Text variant="subtitle" className="mt-2 text-center">
          {t('restore.confirmSubtitle')}
        </Text>

        {summary ? (
          <View className="mt-6 rounded-2xl border border-border bg-white p-5" style={{gap: 10}}>
            <CountRow label={t('restore.countTransactions')} value={summary.transactions} />
            <CountRow label={t('restore.countCustomers')} value={summary.customers} />
            <CountRow label={t('restore.countLedger')} value={summary.ledgerEntries} />
          </View>
        ) : null}

        <View className="mt-8" style={{gap: 8}}>
          <Button title={t('restore.restoreCta')} onPress={() => void startRestore()} />
          <Button
            title={t('restore.skip')}
            variant="ghost"
            onPress={() => finish('skipped')}
          />
        </View>
      </View>
    </Screen>
  );
}

function CountRow({label, value}: {label: string; value: number}): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-base text-slate-700">{label}</Text>
      <Text className="text-base font-bold text-slate-900">{value}</Text>
    </View>
  );
}
