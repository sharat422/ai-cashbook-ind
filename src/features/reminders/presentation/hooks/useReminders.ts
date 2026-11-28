import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useCallback, useMemo} from 'react';

import type {
  Reminder,
  ReminderChannel,
  ReminderTemplate,
  ReminderTemplateKey,
} from '@features/reminders/domain/entities';
import {remindersRemote, type ServerReminder} from '@features/reminders/data/reminders.remote';
import {TEMPLATE_ORDER} from '@features/reminders/domain/templates';
import {useT, type TKey} from '@/i18n';
import {dispatchReminder} from '@features/reminders/presentation/dispatch';
import {useReminderHistoryStore} from '@features/reminders/presentation/store/reminderHistory.store';
import {useReminderTemplatesStore} from '@features/reminders/presentation/store/reminderTemplates.store';

/** Effective templates (defaults merged with user customizations) + editing. */
export function useReminderTemplates() {
  const overrides = useReminderTemplatesStore(s => s.overrides);
  const setBody = useReminderTemplatesStore(s => s.setBody);
  const resetBody = useReminderTemplatesStore(s => s.resetBody);
  const t = useT();

  // Built-in wording follows the app language; a customised body is kept as typed.
  const templates = useMemo<ReminderTemplate[]>(
    () =>
      TEMPLATE_ORDER.map(key => ({
        key,
        name: t(`reminders.tpl.${key}.name` as TKey),
        body: overrides[key] ?? t(`reminders.tpl.${key}.body` as TKey),
      })),
    [overrides, t],
  );

  const isCustomized = useCallback(
    (key: ReminderTemplateKey) => overrides[key] !== undefined,
    [overrides],
  );

  return {templates, setBody, resetBody, isCustomized};
}

const fromServer = (r: ServerReminder): Reminder => ({
  id: r.id,
  customerId: r.customerId,
  channel: r.channel === 'sms' ? 'sms' : 'whatsapp',
  message: r.message ?? r.note ?? '',
  status: r.status,
  createdAt: r.createdAt,
  automatic: r.automatic,
  sentByName: r.sentByName,
});

/** Reminder history for a customer (newest first): the shared history on the
 *  server (every phone's, and the automatic ones); offline, this phone's own. */
export function useReminderHistory(customerId: string): Reminder[] {
  const shared = useQuery({queryKey: ['reminders', customerId], queryFn: () => remindersRemote.history(customerId),
    enabled: !!customerId});
  // Select the stable `reminders` reference, then derive the filtered list in a
  // memo. Filtering *inside* the selector returns a new array every render,
  // which makes zustand's useSyncExternalStore loop ("Maximum update depth").
  const reminders = useReminderHistoryStore(s => s.reminders);
  return useMemo(
    () => shared.data ? shared.data.map(fromServer) : reminders.filter(r => r.customerId === customerId),
    [shared.data, reminders, customerId],
  );
}

/** Send a reminder and record it (with its status) in the history. */
export function useSendReminder() {
  const add = useReminderHistoryStore(s => s.add);
  const qc = useQueryClient();

  return useCallback(
    async (input: {
      customerId: string;
      customerName: string;
      mobile: string;
      channel: ReminderChannel;
      templateKey: ReminderTemplateKey;
      message: string;
    }) => {
      const status = await dispatchReminder({
        channel: input.channel,
        customerName: input.customerName,
        mobile: input.mobile,
        message: input.message,
      });
      add({
        id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        customerId: input.customerId,
        channel: input.channel,
        templateKey: input.templateKey,
        message: input.message,
        status,
        createdAt: new Date().toISOString(),
      });
      // Into the shared history, for every phone (offline: this phone's history has it).
      if (status === 'sent' && input.channel !== 'push') {
        remindersRemote.record({customerId: input.customerId, channel: input.channel, message: input.message})
          .then(() => qc.invalidateQueries({queryKey: ['reminders']}))
          .catch(() => undefined);
      }
      return status;
    },
    [add, qc],
  );
}
