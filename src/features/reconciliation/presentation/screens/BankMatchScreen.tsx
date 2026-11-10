import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {Button, Input, Screen, Text} from '@components/ui';
import {reconciliationRemote, type BankLine, type CashDeposit, type Collection} from '@features/reconciliation/data/reconciliation.remote';
import {formatMoney} from '@features/reconciliation/domain/money';
import {useReconMutations} from '@features/reconciliation/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate} from '@utils/date';

const paise = (m: string) => Math.round(Number(m) * 100);

/**
 * Match a bank line by hand: pick one or more collections (any date) whose
 * total is what's left on the line — e.g. ₹1,000 in the bank = ₹600 + ₹400.
 * Tick more bank lines for several transfers paying several bills (₹900 +
 * ₹600 for three ₹500 bills): then both sides must be covered exactly.
 */
export function BankMatchScreen({navigation, route}: AppScreenProps<'BankMatch'>): React.JSX.Element {
  const p = route.params;
  const done = () => navigation.goBack();
  if ('deposit' in p) {
    return <DepositMatch deposit={p.deposit} onDone={done} />;
  }
  return 'collection' in p ? <SplitMatch collection={p.collection} onDone={done} /> : <LineMatch line={p.line} onDone={done} />;
}

const fail = (t: ReturnType<typeof useT>) => (e: unknown) =>
  Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));

function LineMatch({line, onDone}: {line: BankLine; onDone: () => void}): React.JSX.Element {
  const t = useT();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Collection[]>([]);
  const [moreLines, setMoreLines] = useState<BankLine[]>([]);
  const [showLines, setShowLines] = useState(false);
  const {match, matchMany} = useReconMutations();
  const list = useQuery<Collection[]>({
    queryKey: ['reconciliation', 'candidates', line.id, search],
    queryFn: () => reconciliationRemote.candidates(line.id, search),
  });
  const others = useQuery<BankLine[]>({
    queryKey: ['reconciliation', 'otherLines', line.id],
    queryFn: () => reconciliationRemote.otherLines(line.id),
    enabled: showLines,
  });

  const left = [line, ...moreLines].reduce((s, l) => s + paise(l.remaining), 0);
  const total = picked.reduce((s, c) => s + paise(c.amount), 0);
  const many = moreLines.length > 0;
  // One line may keep money for later; several lines must be covered exactly.
  const ok = picked.length > 0 && (many ? total === left : total <= left);
  const toggle = (c: Collection) =>
    setPicked(p => (p.some(x => x.id === c.id) ? p.filter(x => x.id !== c.id) : [...p, c]));
  const toggleLine = (l: BankLine) =>
    setMoreLines(p => (p.some(x => x.id === l.id) ? p.filter(x => x.id !== l.id) : [...p, l]));
  const money = (p: number) => formatMoney((p / 100).toFixed(2));

  const onMatch = () =>
    many
      ? matchMany.mutate(
          {bankLineIds: [line.id, ...moreLines.map(l => l.id)], entryIds: picked.map(c => c.id)},
          {onSuccess: onDone, onError: fail(t)},
        )
      : match.mutate(
          {bankLineId: line.id, entryIds: picked.map(c => c.id)},
          {onSuccess: onDone, onError: fail(t)},
        );

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('bankMatch.title')}</Text>
        <View className="mt-4 rounded-2xl border border-border bg-white p-4">
          <Text className="text-base font-bold">{formatMoney(line.amount)}</Text>
          <Text variant="caption">
            🏦 {formatDisplayDate(line.date)}{line.utr ? ` · ${line.utr}` : ''}{line.narration ? `\n${line.narration}` : ''}
          </Text>
          {line.remaining !== line.amount ? (
            <Text variant="caption">{t('bankMatch.left', {amount: formatMoney(line.remaining)})}</Text>
          ) : null}
        </View>

        {/* Several transfers for several bills: add the other bank lines. */}
        <Button testID="more-lines" title={t('bankMatch.addLines')} variant="ghost" className="mt-2"
          onPress={() => setShowLines(v => !v)} />
        {showLines ? (
          <View className="mt-1" style={{gap: 8}}>
            {(others.data ?? []).map((l: BankLine) => {
              const on = moreLines.some(x => x.id === l.id);
              return (
                <Pressable key={l.id} testID={`more-line-${l.id}`} accessibilityRole="checkbox"
                  accessibilityState={{checked: on}} onPress={() => toggleLine(l)}
                  className={`rounded-xl border p-3 ${on ? 'border-primary bg-indigo-50' : 'border-border bg-white'}`}>
                  <Text className="text-sm font-semibold">{on ? '☑' : '☐'} 🏦 {formatMoney(l.remaining)}</Text>
                  <Text variant="caption">
                    {formatDisplayDate(l.date)}{l.utr ? ` · ${l.utr}` : ''}{l.narration ? ` · ${l.narration}` : ''}
                  </Text>
                </Pressable>
              );
            })}
            {others.data && others.data.length === 0 ? <Text variant="caption">{t('bankMatch.noLines')}</Text> : null}
          </View>
        ) : null}

        <Input label={t('bankMatch.search')} value={search} onChangeText={setSearch} className="mt-4" />

        <View className="mt-3" style={{gap: 8}}>
          {(list.data ?? []).map((c: Collection) => {
            const on = picked.some(x => x.id === c.id);
            return (
              <Pressable key={c.id} testID={`cand-${c.id}`} accessibilityRole="checkbox" accessibilityState={{checked: on}}
                onPress={() => toggle(c)}
                className={`rounded-xl border p-3 ${on ? 'border-primary bg-indigo-50' : 'border-border bg-white'}`}>
                <Text className="text-sm font-semibold">{on ? '☑' : '☐'} {formatMoney(c.amount)} · {c.customerName}</Text>
                <Text variant="caption">
                  {formatDisplayDate(c.date)}{c.mode ? ` · ${c.mode.toUpperCase()}` : ''}{c.reference ? ` · ${c.reference}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {list.data && list.data.length === 0 ? <Text variant="caption">{t('bankMatch.none')}</Text> : null}
        </View>

        {many ? (
          <>
            <Text testID="match-total-bank" className={`mt-5 text-sm font-semibold ${total > left ? 'text-red-700' : ''}`}>
              {t('bankMatch.pickedBank', {picked: money(Math.min(total, left)), of: money(left)})}
            </Text>
            <Text testID="match-total-collections" className={`text-sm font-semibold ${total > left ? 'text-red-700' : ''}`}>
              {t('bankMatch.pickedCollections', {picked: money(Math.min(total, left)), of: money(total)})}
            </Text>
          </>
        ) : (
          <Text testID="match-total" className={`mt-5 text-sm font-semibold ${total > left ? 'text-red-700' : ''}`}>
            {t('bankMatch.total', {picked: money(total), left: formatMoney(line.remaining)})}
          </Text>
        )}
        <Button testID="match-confirm" title={t('bankMatch.confirm')} className="mt-3"
          loading={match.isPending || matchMany.isPending}
          disabled={!ok || match.isPending || matchMany.isPending} onPress={onMatch} />
      </View>
    </Screen>
  );
}

/**
 * The mirror: one collection paid in several transfers (₹1,000 = ₹600 + ₹400
 * in the bank). Tick the bank lines; Match only once they cover it exactly.
 */
function SplitMatch({collection, onDone}: {collection: Collection; onDone: () => void}): React.JSX.Element {
  const t = useT();
  const [picked, setPicked] = useState<BankLine[]>([]);
  const {split} = useReconMutations();
  const list = useQuery<BankLine[]>({
    queryKey: ['reconciliation', 'lineCandidates', collection.id],
    queryFn: () => reconciliationRemote.lineCandidates(collection.id),
  });
  const need = paise(collection.amount);
  const total = picked.reduce((s, l) => s + paise(l.remaining), 0);
  const toggle = (l: BankLine) =>
    setPicked(p => (p.some(x => x.id === l.id) ? p.filter(x => x.id !== l.id) : [...p, l]));

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('bankMatch.title')}</Text>
        <View className="mt-4 rounded-2xl border border-border bg-white p-4">
          <Text className="text-base font-bold">{formatMoney(collection.amount)} · {collection.customerName}</Text>
          <Text variant="caption">
            {formatDisplayDate(collection.date)}{collection.mode ? ` · ${collection.mode.toUpperCase()}` : ''}
            {collection.reference ? ` · ${collection.reference}` : ''}
          </Text>
        </View>
        <Text variant="caption" className="mt-4">{t('bankMatch.splitHint')}</Text>

        <View className="mt-3" style={{gap: 8}}>
          {(list.data ?? []).map((l: BankLine) => {
            const on = picked.some(x => x.id === l.id);
            return (
              <Pressable key={l.id} testID={`line-${l.id}`} accessibilityRole="checkbox" accessibilityState={{checked: on}}
                onPress={() => toggle(l)}
                className={`rounded-xl border p-3 ${on ? 'border-primary bg-indigo-50' : 'border-border bg-white'}`}>
                <Text className="text-sm font-semibold">{on ? '☑' : '☐'} 🏦 {formatMoney(l.remaining)}</Text>
                <Text variant="caption">
                  {formatDisplayDate(l.date)}{l.utr ? ` · ${l.utr}` : ''}{l.narration ? ` · ${l.narration}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {list.data && list.data.length === 0 ? <Text variant="caption">{t('bankMatch.noLines')}</Text> : null}
        </View>

        <Text testID="split-total" className={`mt-5 text-sm font-semibold ${total > need ? 'text-red-700' : ''}`}>
          {t('bankMatch.total', {picked: formatMoney((total / 100).toFixed(2)), left: formatMoney(collection.amount)})}
        </Text>
        <Button testID="split-confirm" title={t('bankMatch.confirm')} className="mt-3" loading={split.isPending}
          disabled={picked.length < 2 || total !== need || split.isPending}
          onPress={() => split.mutate({bankLineIds: picked.map(l => l.id), entryId: collection.id},
            {onSuccess: onDone, onError: fail(t)})} />
      </View>
    </Screen>
  );
}

/** A cash deposit to its bank line: one line whose remaining amount is exactly the deposit. */
function DepositMatch({deposit, onDone}: {deposit: CashDeposit; onDone: () => void}): React.JSX.Element {
  const t = useT();
  const {matchDeposit} = useReconMutations();
  const list = useQuery<BankLine[]>({
    queryKey: ['reconciliation', 'depositLines', deposit.id],
    queryFn: () => reconciliationRemote.depositLines(deposit.id),
  });
  const pick = (l: BankLine) =>
    Alert.alert(t('deposit.matchTitle'), t('deposit.matchMsg', {amount: formatMoney(deposit.amount), date: formatDisplayDate(l.date)}), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('bankMatch.confirm'), onPress: () =>
        matchDeposit.mutate({depositId: deposit.id, bankLineId: l.id}, {onSuccess: onDone, onError: fail(t)})},
    ]);

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('bankMatch.title')}</Text>
        <View className="mt-4 rounded-2xl border border-border bg-white p-4">
          <Text className="text-base font-bold">🏦 {formatMoney(deposit.amount)}</Text>
          <Text variant="caption">{t('deposit.cashDeposit')} · {formatDisplayDate(deposit.date)}</Text>
        </View>
        <Text variant="caption" className="mt-4">{t('deposit.pickLine')}</Text>
        <View className="mt-3" style={{gap: 8}}>
          {(list.data ?? []).map((l: BankLine) => {
            const same = paise(l.remaining) === paise(deposit.amount);
            return (
              <Pressable key={l.id} testID={`dep-line-${l.id}`} disabled={!same || matchDeposit.isPending}
                onPress={() => pick(l)}
                className={`rounded-xl border p-3 ${same ? 'border-border bg-white' : 'border-border bg-slate-50 opacity-50'}`}>
                <Text className="text-sm font-semibold">🏦 {formatMoney(l.remaining)}</Text>
                <Text variant="caption">
                  {formatDisplayDate(l.date)}{l.utr ? ` · ${l.utr}` : ''}{l.narration ? ` · ${l.narration}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {list.data && list.data.length === 0 ? <Text variant="caption">{t('bankMatch.noLines')}</Text> : null}
        </View>
      </View>
    </Screen>
  );
}
