import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {
  CHANNEL_ICON,
  type Reminder,
  type ReminderStatus,
} from '@features/reminders/domain/entities';
import {formatTimestampDate} from '@utils/date';
import {useT, type TKey} from '@/i18n';

const STATUS_STYLE: Record<
  ReminderStatus,
  {bg: string; text: string}
> = {
  sent: {bg: 'bg-green-50', text: 'text-success'},
  failed: {bg: 'bg-red-50', text: 'text-danger'},
  pending: {bg: 'bg-amber-50', text: 'text-amber-700'},
};

function Row({reminder}: {reminder: Reminder}): React.JSX.Element {
  const t = useT();
  const s = STATUS_STYLE[reminder.status];
  return (
    <View className="rounded-xl border border-border bg-white px-3.5 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-slate-900">
          {CHANNEL_ICON[reminder.channel]} {t(`reminders.channel.${reminder.channel}` as TKey)}
          <Text className="text-xs font-normal text-muted">
            {' · '}
            {t(`reminders.tpl.${reminder.templateKey}.name` as TKey)}
          </Text>
        </Text>
        <View className={`rounded-full px-2 py-0.5 ${s.bg}`}>
          <Text className={`text-[10px] font-semibold ${s.text}`}>
            {t(`reminders.status.${reminder.status}` as TKey)}
          </Text>
        </View>
      </View>
      <Text className="mt-1 text-xs text-slate-600" numberOfLines={2}>
        {reminder.message}
      </Text>
      <Text className="mt-1 text-[10px] text-muted">
        {formatTimestampDate(reminder.createdAt)}
      </Text>
    </View>
  );
}

/** Reminder history with per-reminder status — reusable. */
export function ReminderHistoryList({
  reminders,
}: {
  reminders: Reminder[];
}): React.JSX.Element {
  const t = useT();
  if (reminders.length === 0) {
    return <Text variant="caption">{t('reminders.none')}</Text>;
  }
  return (
    <View style={{gap: 8}}>
      {reminders.map(r => (
        <Row key={r.id} reminder={r} />
      ))}
    </View>
  );
}
