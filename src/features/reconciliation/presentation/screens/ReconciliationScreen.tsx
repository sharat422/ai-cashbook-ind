import {errorCodes, isErrorWithCode, pick, types} from '@react-native-documents/picker';
import React from 'react';
import {Alert, RefreshControl, ScrollView, View} from 'react-native';

import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {BankLine, Collection, Suggestion} from '@features/reconciliation/data/reconciliation.remote';
import {formatMoney} from '@features/reconciliation/domain/money';
import {useExceptions, useReconMutations, useSuggestions} from '@features/reconciliation/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate} from '@utils/date';

/**
 * Owner/accountant: import a bank statement, then confirm each suggested
 * bank-line ↔ collection pair by hand. Nothing is confirmed automatically.
 */
export function ReconciliationScreen(_: AppScreenProps<'Reconciliation'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const canEdit = can(PERMISSIONS.ENTRY_EDIT);
  const suggestions = useSuggestions();
  const exceptions = useExceptions();
  const {importFile, confirm} = useReconMutations();

  const onImport = async () => {
    try {
      // Banks label CSVs with odd MIME types; the server checks the content.
      const [file] = await pick({type: [types.allFiles]});
      importFile.mutate(
        {uri: file.uri, name: file.name ?? 'statement.csv', type: file.type ?? 'text/csv'},
        {
          onSuccess: r => {
            if (r.alreadyImported) {
              Alert.alert(t('recon.alreadyImported'));
              return;
            }
            const rejected = r.rejected
              .slice(0, 5)
              .map(x => t('recon.rejectedRow', {row: x.row, reason: x.reason}))
              .join('\n');
            Alert.alert(
              t('recon.importedTitle', {count: r.imported}),
              [
                t('recon.importSummary', {duplicates: r.duplicates, skipped: r.skipped, rejected: r.rejected.length}),
                rejected,
              ]
                .filter(Boolean)
                .join('\n\n'),
            );
          },
          onError: err => Alert.alert(t('recon.importFailed'), err.message),
        },
      );
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert(t('recon.importFailed'), err instanceof Error ? err.message : String(err));
    }
  };

  const onConfirm = (s: Suggestion) =>
    confirm.mutate(
      {bankLineId: s.bankLine.id, entryId: s.collection.id},
      {onError: err => Alert.alert(t('form.couldNotSave'), err.message)},
    );

  const refetch = () => {
    suggestions.refetch();
    exceptions.refetch();
  };
  if (suggestions.isLoading || exceptions.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-24 w-full" />
      </Screen>
    );
  }
  if (suggestions.isError || exceptions.isError) {
    return (
      <Screen>
        <ErrorState onRetry={refetch} retrying={suggestions.isFetching || exceptions.isFetching} />
      </Screen>
    );
  }

  const list: Suggestion[] = suggestions.data ?? [];
  const lonelyLines: BankLine[] = exceptions.data?.bankLines ?? [];
  const lonelyCollections: Collection[] = exceptions.data?.collections ?? [];
  const empty = list.length === 0 && lonelyLines.length === 0 && lonelyCollections.length === 0;

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={suggestions.isRefetching} onRefresh={refetch} />}>
        <Text variant="title">{t('recon.title')}</Text>
        <Text variant="caption" className="mt-1">
          {t('recon.subtitle')}
        </Text>
        {canEdit ? (
          <Button
            title={t('recon.import')}
            className="mt-4"
            loading={importFile.isPending}
            onPress={onImport}
          />
        ) : null}

        {empty ? <EmptyState icon="🏦" title={t('recon.emptyTitle')} message={t('recon.emptyMsg')} /> : null}

        {list.length > 0 ? (
          <Text variant="label" className="mt-8">
            {t('recon.suggested', {count: list.length})}
          </Text>
        ) : null}
        {list.map(s => (
          <View
            key={s.bankLine.id}
            testID={`suggestion-${s.bankLine.id}`}
            className="mt-3 rounded-2xl border border-border bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-slate-900">{formatMoney(s.bankLine.amount)}</Text>
              <Text
                className={`rounded-full px-2 py-0.5 text-xs ${
                  s.match === 'utr' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                }`}>
                {s.match === 'utr' ? t('recon.matchUtr') : t('recon.matchAmountDate', {days: s.dayGap})}
              </Text>
            </View>
            <LineText line={s.bankLine} />
            <CollectionText collection={s.collection} />
            {canEdit ? (
              <Button
                title={t('recon.confirm')}
                variant="secondary"
                className="mt-3"
                disabled={confirm.isPending}
                onPress={() => onConfirm(s)}
              />
            ) : null}
          </View>
        ))}

        {lonelyLines.length > 0 ? (
          <>
            <Text variant="label" className="mt-8">
              {t('recon.unmatchedBank', {count: lonelyLines.length})}
            </Text>
            <Text variant="caption">{t('recon.unmatchedBankHint')}</Text>
            {lonelyLines.map(l => (
              <View key={l.id} className="mt-3 rounded-2xl border border-border bg-white p-4">
                <Text className="text-base font-bold text-slate-900">{formatMoney(l.amount)}</Text>
                <LineText line={l} />
              </View>
            ))}
          </>
        ) : null}

        {lonelyCollections.length > 0 ? (
          <>
            <Text variant="label" className="mt-8">
              {t('recon.unmatchedCollections', {count: lonelyCollections.length})}
            </Text>
            <Text variant="caption">{t('recon.unmatchedCollectionsHint')}</Text>
            {lonelyCollections.map(c => (
              <View key={c.id} className="mt-3 rounded-2xl border border-border bg-white p-4">
                <Text className="text-base font-bold text-red-700">{formatMoney(c.amount)}</Text>
                <CollectionText collection={c} />
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function LineText({line}: {line: BankLine}) {
  const t = useT();
  return (
    <Text variant="caption" className="mt-2">
      🏦 {formatDisplayDate(line.date)}
      {line.utr ? ` · ${t('recon.utr')} ${line.utr}` : ''}
      {line.narration ? `\n${line.narration}` : ''}
    </Text>
  );
}

function CollectionText({collection: c}: {collection: Collection}) {
  return (
    <Text variant="caption" className="mt-1">
      🧾 {c.customerName} · {formatDisplayDate(c.date)}
      {c.mode ? ` · ${c.mode.toUpperCase()}` : ''}
      {c.reference ? ` · ${c.reference}` : ''}
    </Text>
  );
}
