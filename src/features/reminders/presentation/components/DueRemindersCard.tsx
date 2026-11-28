import {useQuery} from '@tanstack/react-query';
import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {remindersRemote, type DueReminder} from '@features/reminders/data/reminders.remote';
import {useT} from '@/i18n';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

/** Why a retailer needs chasing today, in words. */
export function dueReason(t: ReturnType<typeof useT>, d: DueReminder): string {
  if (d.reason === 'promise') {
    return t('reminders.due.promise', {amount: d.promiseAmount != null ? formatINR(d.promiseAmount) : '',
      date: d.promiseDate ? formatDisplayDate(d.promiseDate) : ''});
  }
  return d.daysOverdue
    ? t('reminders.due.overdue', {days: d.daysOverdue})
    : t('reminders.due.missed', {date: d.promiseDate ? formatDisplayDate(d.promiseDate) : ''});
}

/**
 * The day list's "To chase today": the beat's retailers the owner's rules say
 * need a reminder. Opted-in ones go on WhatsApp by themselves when automatic
 * reminders are on; tap any to send one now (it's recorded for every phone).
 */
export function DueRemindersCard({beatId, onPress}: {beatId: string; onPress: (d: DueReminder) => void}) {
  const t = useT();
  const due = useQuery({queryKey: ['reminders', 'due', beatId], queryFn: () => remindersRemote.due(beatId)});
  const items: DueReminder[] = due.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <View testID={`reminders-due-${beatId}`} className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-4" style={{gap: 8}}>
      <Text className="text-sm font-semibold text-sky-900">{t('reminders.due.title')} ({items.length})</Text>
      {items.map(d => (
        <Pressable key={d.customerId} testID={`remind-${d.customerId}`} accessibilityRole="button" onPress={() => onPress(d)}
          className="rounded-xl bg-white px-3 py-2" style={{gap: 2}}>
          <View className="flex-row justify-between" style={{gap: 8}}>
            <Text className="flex-1 text-sm font-semibold">{d.fullName}</Text>
            <Text className="text-sm font-bold">{formatINR(d.outstandingAmount)}</Text>
          </View>
          <Text variant="caption">{dueReason(t, d)}</Text>
          <Text variant="caption">
            {due.data?.auto && d.optedIn ? t('reminders.due.auto') : t('reminders.due.byHand')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
