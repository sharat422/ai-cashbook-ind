import React, {useState} from 'react';
import {Alert, RefreshControl, ScrollView, View} from 'react-native';

import {Button, EmptyState, ErrorState, Input, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {BankLine, Collection, MatchedLine, StatementImport, Suggestion} from '@features/reconciliation/data/reconciliation.remote';
import {formatMoney} from '@features/reconciliation/domain/money';
import {
  useExceptions,
  useMatched,
  useReconMutations,
  useDeletedStatements,
  useStatementImports,
  useSuggestions,
} from '@features/reconciliation/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate} from '@utils/date';

/**
 * Owner/accountant: import a bank statement, then confirm each suggested
 * bank-line ↔ collection pair by hand. Nothing is confirmed automatically.
 */
export function ReconciliationScreen({navigation}: AppScreenProps<'Reconciliation'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const canEdit = can(PERMISSIONS.ENTRY_EDIT);
  const suggestions = useSuggestions();
  const exceptions = useExceptions();
  const matched = useMatched();
  const statements = useStatementImports();
  const {confirm, undo, deleteImport, restoreImport, addUtr} = useReconMutations();
  const [showDeleted, setShowDeleted] = useState(false);
  const deletedStatements = useDeletedStatements(showDeleted);
  const [utrs, setUtrs] = useState<Record<string, string>>({});
  const fail = (e: unknown) =>
    Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));

  const onUndo = (lineId: string) =>
    Alert.alert(t('recon.undoTitle'), t('recon.undoMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('recon.undo'), style: 'destructive', onPress: () => undo.mutate(lineId, {onError: fail})},
    ]);
  const onDeleteStatement = (id: string, lines: number) =>
    Alert.alert(t('recon.deleteStatementTitle'), t('recon.deleteStatementMsg', {count: lines}), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('recon.deleteStatement'), style: 'destructive', onPress: () => deleteImport.mutate(id, {onError: fail})},
    ]);

  const onRestoreStatement = (st: StatementImport) =>
    Alert.alert(t('recon.restoreTitle'), t('recon.restoreMsg', {count: st.lines}), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('recon.restore'), onPress: () => restoreImport.mutate(st.id, {onError: fail})},
    ]);

  const onConfirm = (s: Suggestion) =>
    confirm.mutate(
      {bankLineId: s.bankLine.id, entryId: s.collection.id},
      {onError: err => Alert.alert(t('form.couldNotSave'), err.message)},
    );

  const refetch = () => {
    suggestions.refetch();
    exceptions.refetch();
    matched.refetch();
    statements.refetch();
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
            testID="recon-import"
            title={t('recon.import')}
            className="mt-4"
            onPress={() => navigation.navigate('BankImport')}
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
                {l.remaining !== l.amount ? (
                  <Text variant="caption">{t('bankMatch.left', {amount: formatMoney(l.remaining)})}</Text>
                ) : null}
                <LineText line={l} />
                {canEdit ? (
                  <Button testID={`match-hand-${l.id}`} title={t('recon.matchByHand')} variant="secondary"
                    className="mt-3" onPress={() => navigation.navigate('BankMatch', {line: l})} />
                ) : null}
              </View>
            ))}
          </>
        ) : null}

        {(exceptions.data?.missingUtr ?? []).length > 0 ? (
          <>
            <Text variant="label" className="mt-8">{t('recon.missingUtr')}</Text>
            <Text variant="caption">{t('recon.missingUtrHint')}</Text>
            {(exceptions.data?.missingUtr ?? []).map((c: Collection) => (
              <View key={c.id} className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <Text className="text-base font-bold">{formatMoney(c.amount)}</Text>
                <CollectionText collection={c} />
                {canEdit ? (
                  <>
                    <Input testID={`utr-${c.id}`} placeholder={t('recon.utr')} keyboardType="number-pad"
                      value={utrs[c.id] ?? ''} onChangeText={v => setUtrs(u => ({...u, [c.id]: v}))} />
                    <Button title={t('common.save')} variant="secondary" className="mt-2"
                      disabled={!(utrs[c.id] ?? '').trim() || addUtr.isPending}
                      onPress={() => addUtr.mutate({customerId: c.customerId, entryId: c.id, utr: utrs[c.id]}, {onError: fail})} />
                  </>
                ) : null}
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
                {canEdit ? (
                  <Button testID={`split-hand-${c.id}`} title={t('recon.matchByHand')} variant="secondary"
                    className="mt-3" onPress={() => navigation.navigate('BankMatch', {collection: c})} />
                ) : null}
              </View>
            ))}
          </>
        ) : null}
        {(matched.data ?? []).length > 0 ? (
          <>
            <Text variant="label" className="mt-8">{t('recon.matchedHeading')}</Text>
            {(matched.data ?? []).slice(0, 30).map((m: MatchedLine) => (
              <View key={m.bankLine.id} testID={`matched-${m.bankLine.id}`} className="mt-3 rounded-2xl border border-border bg-white p-4">
                <Text className="text-base font-bold text-green-800">✓ {formatMoney(m.bankLine.amount)}</Text>
                <LineText line={m.bankLine} />
                {m.collections.map((c: Collection) => <CollectionText key={c.id} collection={c} />)}
                {(m.deposits ?? []).map(d => (
                  <Text key={d.id} variant="caption">🏦 {t('deposit.cashDeposit')} · {formatMoney(d.amount)}</Text>
                ))}
                {canEdit ? (
                  <Button testID={`undo-${m.bankLine.id}`} title={t('recon.undo')} variant="ghost" className="mt-2"
                    onPress={() => onUndo(m.bankLine.id)} />
                ) : null}
              </View>
            ))}
          </>
        ) : null}

        {(statements.data ?? []).length > 0 ? (
          <>
            <Text variant="label" className="mt-8">{t('recon.statements')}</Text>
            {(statements.data ?? []).map((st: StatementImport) => (
              <View key={st.id} className="mt-3 rounded-2xl border border-border bg-white p-4">
                <Text className="text-sm font-semibold">{st.filename}</Text>
                <Text variant="caption">
                  {t('recon.statementLines', {count: st.lines})}
                  {st.from ? ` · ${formatDisplayDate(st.from)} – ${formatDisplayDate(st.to ?? st.from)}` : ''}
                </Text>
                {canEdit ? (
                  <Button testID={`delete-statement-${st.id}`} title={t('recon.deleteStatement')} variant="ghost"
                    className="mt-1" onPress={() => onDeleteStatement(st.id, st.lines)} />
                ) : null}
              </View>
            ))}
          </>
        ) : null}

        {canEdit ? (
          <>
            <Button testID="show-deleted-statements" title={t('recon.deletedStatements')} variant="ghost" className="mt-6"
              onPress={() => setShowDeleted(v => !v)} />
            {showDeleted ? (
              !deletedStatements.data?.length ? (
                <Text variant="caption" className="mt-2">{t('recon.noDeletedStatements')}</Text>
              ) : (
                deletedStatements.data.map((st: StatementImport) => (
                  <View key={st.id} testID={`deleted-statement-${st.id}`}
                    className="mt-3 rounded-2xl border border-border bg-slate-50 p-4">
                    <Text className="text-sm font-semibold">{st.filename}</Text>
                    <Text variant="caption">
                      {t('recon.statementLines', {count: st.lines})}
                      {st.from ? ` · ${formatDisplayDate(st.from)} – ${formatDisplayDate(st.to ?? st.from)}` : ''}
                    </Text>
                    <Button testID={`restore-statement-${st.id}`} title={t('recon.restore')} variant="secondary"
                      className="mt-2" loading={restoreImport.isPending && restoreImport.variables === st.id}
                      onPress={() => onRestoreStatement(st)} />
                  </View>
                ))
              )
            ) : null}
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
