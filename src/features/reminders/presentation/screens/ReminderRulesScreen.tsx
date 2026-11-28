import {useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useEffect, useState} from 'react';
import {Alert, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {FormField} from '@components/form';
import {Button, ErrorState, Screen, SegmentedControl, Skeleton, Text} from '@components/ui';
import type {Beat} from '@features/beats/data/beats.remote';
import {useBeats} from '@features/beats/presentation/hooks';
import {remindersRemote, type ReminderRules} from '@features/reminders/data/reminders.remote';
import {useT} from '@/i18n';

const BEFORE = [null, 0, 1, 2, 3] as const;
const OVERDUE = [null, 1, 3, 7, 15] as const;
const REPEAT = [3, 7, 14] as const;

/**
 * Settings → Automatic reminders (owner): who needs chasing and when. With
 * "Send automatically" on, retailers who agreed to WhatsApp statements get theirs
 * as the reminder (balance and a link), at most once a day, 9 a.m. to 8 p.m.;
 * the rest are on the day list's "To chase today", to send by hand.
 */
export function ReminderRulesScreen(): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const saved = useQuery({queryKey: ['reminders', 'rules'], queryFn: remindersRemote.rules});
  const beats: Beat[] = useBeats().data ?? [];
  const [rules, setRules] = useState<ReminderRules | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (saved.data) setRules(saved.data);
  }, [saved.data]);
  const set = (patch: Partial<ReminderRules>) => setRules(r => (r ? {...r, ...patch} : r));
  const days = (n: number | null) => (n === null ? t('reminders.rules.off') : n === 0 ? t('reminders.rules.sameDay')
    : t('reminders.rules.days', {n}));

  const save = async () => {
    if (!rules) return;
    setSaving(true);
    try {
      setRules(await remindersRemote.saveRules(rules));
      await qc.invalidateQueries({queryKey: ['reminders']});
      Alert.alert(t('reminders.rules.saved'));
    } catch (e) {
      Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View className="py-6" style={{gap: 16}}>
        <Text variant="title">{t('reminders.rules.title')}</Text>
        <Text variant="subtitle">{t('reminders.rules.subtitle')}</Text>
        {saved.isLoading || !rules ? (
          saved.isError ? <ErrorState onRetry={() => saved.refetch()} retrying={saved.isFetching} />
            : <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <FormField label={t('reminders.rules.auto')} hint={t('reminders.rules.autoHint')}>
              <SegmentedControl value={rules.enabled} onChange={enabled => set({enabled})}
                options={[{label: t('reminders.rules.autoOn'), value: true}, {label: t('reminders.rules.autoOff'), value: false}]} />
            </FormField>
            <FormField label={t('reminders.rules.beforePromise')}>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {BEFORE.map(n => (
                  <FilterChip key={String(n)} label={days(n)} selected={rules.beforePromiseDays === n}
                    onPress={() => set({beforePromiseDays: n})} />
                ))}
              </View>
            </FormField>
            <FormField label={t('reminders.rules.overdue')} hint={t('reminders.rules.overdueHint')}>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {OVERDUE.map(n => (
                  <FilterChip key={String(n)} label={days(n)} selected={rules.overdueDays === n}
                    onPress={() => set({overdueDays: n})} />
                ))}
              </View>
            </FormField>
            <FormField label={t('reminders.rules.repeat')}>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {REPEAT.map(n => (
                  <FilterChip key={n} label={t('reminders.rules.days', {n})} selected={rules.repeatDays === n}
                    onPress={() => set({repeatDays: n})} />
                ))}
              </View>
            </FormField>
            <FormField label={t('reminders.rules.who')}>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                <FilterChip label={t('reminders.rules.everyone')} selected={rules.beatId === null}
                  onPress={() => set({beatId: null})} />
                {beats.map(b => (
                  <FilterChip key={b.id} label={b.name} selected={rules.beatId === b.id} onPress={() => set({beatId: b.id})} />
                ))}
              </View>
            </FormField>
            <Button testID="rules-save" title={t('common.save')} loading={saving} disabled={saving}
              onPress={() => void save()} />
          </>
        )}
      </View>
    </Screen>
  );
}
