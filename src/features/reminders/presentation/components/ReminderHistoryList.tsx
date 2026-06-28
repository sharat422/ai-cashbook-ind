import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  type Reminder,
  type ReminderStatus,
} from '@features/reminders/domain/entities';
import {DEFAULT_TEMPLATES} from '@features/reminders/domain/templates';
import {formatDisplayDate} from '@utils/date';

const STATUS_STYLE: Record<
  ReminderStatus,
  {label: string; bg: string; text: string}
> = {
  sent: {label: 'Sent', bg: 'bg-green-50', text: 'text-success'},
  failed: {label: 'Failed', bg: 'bg-red-50', text: 'text-danger'},
  pending: {label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700'},
};

function Row({reminder}: {reminder: Reminder}): React.JSX.Element {
  const s = STATUS_STYLE[reminder.status];
  return (
    <View className="rounded-xl border border-border bg-white px-3.5 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-slate-900">
          {CHANNEL_ICON[reminder.channel]} {CHANNEL_LABEL[reminder.channel]}
          <Text className="text-xs font-normal text-muted">
            {' · '}
            {DEFAULT_TEMPLATES[reminder.templateKey].name}
          </Text>
        </Text>
        <View className={`rounded-full px-2 py-0.5 ${s.bg}`}>
          <Text className={`text-[10px] font-semibold ${s.text}`}>
            {s.label}
          </Text>
        </View>
      </View>
      <Text className="mt-1 text-xs text-slate-600" numberOfLines={2}>
        {reminder.message}
      </Text>
      <Text className="mt-1 text-[10px] text-muted">
        {formatDisplayDate(reminder.createdAt.slice(0, 10))}
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
  if (reminders.length === 0) {
    return (
      <Text variant="caption">No reminders sent yet for this customer.</Text>
    );
  }
  return (
    <View style={{gap: 8}}>
      {reminders.map(r => (
        <Row key={r.id} reminder={r} />
      ))}
    </View>
  );
}
