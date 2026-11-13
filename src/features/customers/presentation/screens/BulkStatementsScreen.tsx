import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {Button, Screen, SegmentedControl, Select, Text} from '@components/ui';
import {beatsRemote, type Beat} from '@features/beats/data/beats.remote';
import {
  statementsRemote,
  type BulkResult,
  type StatementSchedule,
} from '@features/customers/data/statements.remote';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

const DAYS = Array.from({length: 28}, (_, i) => String(i + 1));
const HOURS = Array.from({length: 11}, (_, i) => String(i + 9)); // 9 a.m. … 7 p.m. IST
const hourLabel = (h: string) => `${Number(h) % 12 || 12} ${Number(h) < 12 ? 'a.m.' : 'p.m.'}`;

/**
 * Owner: send every opted-in retailer (or one beat's) their statement on
 * WhatsApp now, or every month. The server keeps the caps: opted-in only,
 * the approved template, one message a day, 9 a.m.–8 p.m. IST, and it stops
 * a batch above 10% failures — saying why.
 */
export function BulkStatementsScreen(_props: AppScreenProps<'BulkStatements'>): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const [beatId, setBeatId] = useState<string | null>(null);
  const beats = useQuery({queryKey: ['beats', 'list'], queryFn: beatsRemote.list});
  const preview = useQuery({
    queryKey: ['bulk-preview', beatId],
    queryFn: () => statementsRemote.bulkPreview(beatId ?? undefined),
  });
  const [result, setResult] = useState<BulkResult | null>(null);
  const send = useMutation({
    mutationFn: () => statementsRemote.bulkSend(beatId ?? undefined),
    onSuccess: r => {
      setResult(r);
      qc.invalidateQueries({queryKey: ['bulk-preview']});
    },
    onError: (e: Error) => Alert.alert(t('bulk.failedTitle'), e.message),
  });

  const schedule = useQuery({queryKey: ['statement-schedule'], queryFn: statementsRemote.schedule});
  const [draft, setDraft] = useState<Partial<StatementSchedule>>({});
  const s: StatementSchedule | undefined = schedule.data && {...schedule.data, ...draft};
  const saveSchedule = useMutation({
    mutationFn: (next: StatementSchedule) => statementsRemote.setSchedule(next),
    onSuccess: data => {
      qc.setQueryData(['statement-schedule'], data);
      setDraft({});
    },
    onError: (e: Error) => Alert.alert(t('form.couldNotSave'), e.message),
  });

  const p = preview.data;
  const blocked = p && (p.templateStatus !== 'APPROVED'
    ? t('bulk.templateOff', {status: p.templateStatus})
    : !p.inWindow ? t('bulk.outsideWindow') : null);
  const confirm = () =>
    Alert.alert(t('bulk.confirmTitle'), t('bulk.confirmMsg', {count: p?.willSend ?? 0}), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('bulk.sendShort'), onPress: () => send.mutate()},
    ]);
  const last = s?.lastResult;

  return (
    <Screen>
      <View className="py-6" style={{gap: 12}}>
        <Text variant="title">{t('bulk.title')}</Text>
        <Text variant="subtitle">{t('bulk.subtitle')}</Text>

        <View className="flex-row flex-wrap" style={{gap: 8}}>
          <FilterChip label={t('bulk.all')} selected={beatId === null} onPress={() => setBeatId(null)} />
          {(beats.data ?? []).map((b: Beat) => (
            <FilterChip key={b.id} label={b.name} selected={beatId === b.id} onPress={() => setBeatId(b.id)} />
          ))}
        </View>

        {p ? (
          <View testID="bulk-preview" className="rounded-2xl border border-border bg-white p-4" style={{gap: 4}}>
            <Text className="text-base font-bold">{t('bulk.willSend', {count: p.willSend})}</Text>
            <Text variant="caption">{t('bulk.optedIn', {count: p.optedIn})}</Text>
            <Text variant="caption">{t('bulk.notOptedIn', {count: p.notOptedIn})}</Text>
            <Text variant="caption">{t('bulk.alreadyToday', {count: p.alreadyToday})}</Text>
            {blocked ? <Text testID="bulk-blocked" className="mt-1 text-sm text-danger">{blocked}</Text> : null}
          </View>
        ) : null}
        <Button testID="bulk-send" title={t('bulk.send', {count: p?.willSend ?? 0})} loading={send.isPending}
          disabled={!p || !!blocked || p.willSend === 0 || send.isPending} onPress={confirm} />

        {result ? (
          <View testID="bulk-result" className="rounded-2xl border border-border bg-white p-4" style={{gap: 4}}>
            <Text className="text-sm font-semibold">
              {t('bulk.result', {sent: result.sent, skipped: result.notOptedIn + result.alreadyToday + result.noMobile,
                failed: result.failed})}
            </Text>
            {result.stopped ? <Text testID="bulk-stopped" className="text-sm text-danger">{result.stopped}</Text> : null}
            {result.notTried ? <Text variant="caption">{t('bulk.notTried', {count: result.notTried})}</Text> : null}
          </View>
        ) : null}

        {s ? (
          <View testID="bulk-schedule" className="mt-4 rounded-2xl border border-border bg-white p-4" style={{gap: 10}}>
            <Text className="text-sm font-bold text-slate-900">{t('bulk.scheduleTitle')}</Text>
            <SegmentedControl
              value={s.enabled}
              options={[{label: t('bulk.scheduleOn'), value: true}, {label: t('bulk.scheduleOff'), value: false}]}
              onChange={enabled => (enabled
                ? setDraft(d => ({...d, enabled: true}))
                : saveSchedule.mutate({...s, enabled: false}))}  // off in one tap
            />
            {s.enabled ? (
              <>
                <Select label={t('bulk.day')} value={String(s.day)} options={DAYS}
                  onSelect={d => setDraft(x => ({...x, day: Number(d)}))} />
                <Select label={t('bulk.hour')} value={String(s.hour)} options={HOURS} labelOf={hourLabel}
                  onSelect={h => setDraft(x => ({...x, hour: Number(h)}))} />
                <Text variant="caption">{t('bulk.scheduleScope', {scope: beatId
                  ? beats.data?.find((b: Beat) => b.id === beatId)?.name ?? '' : t('bulk.all')})}</Text>
                <Button testID="bulk-schedule-save" title={t('bulk.scheduleSave')} variant="secondary"
                  loading={saveSchedule.isPending} onPress={() => saveSchedule.mutate({...s, beatId})} />
              </>
            ) : null}
            {last ? (
              <Text variant="caption">
                {last.stopped && !last.sent
                  ? t('bulk.lastRunStopped', {month: s.lastRunMonth ?? '', reason: last.stopped})
                  : t('bulk.lastRun', {month: s.lastRunMonth ?? '', sent: last.sent ?? 0,
                    skipped: (last.notOptedIn ?? 0) + (last.alreadyToday ?? 0) + (last.noMobile ?? 0),
                    failed: last.failed ?? 0})}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
