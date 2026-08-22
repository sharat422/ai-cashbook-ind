import {useCallback, useMemo} from 'react';

import type {
  Reminder,
  ReminderChannel,
  ReminderTemplate,
  ReminderTemplateKey,
} from '@features/reminders/domain/entities';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_ORDER,
} from '@features/reminders/domain/templates';
import {dispatchReminder} from '@features/reminders/presentation/dispatch';
import {useReminderHistoryStore} from '@features/reminders/presentation/store/reminderHistory.store';
import {useReminderTemplatesStore} from '@features/reminders/presentation/store/reminderTemplates.store';

/** Effective templates (defaults merged with user customizations) + editing. */
export function useReminderTemplates() {
  const overrides = useReminderTemplatesStore(s => s.overrides);
  const setBody = useReminderTemplatesStore(s => s.setBody);
  const resetBody = useReminderTemplatesStore(s => s.resetBody);

  const templates = useMemo<ReminderTemplate[]>(
    () =>
      TEMPLATE_ORDER.map(key => ({
        ...DEFAULT_TEMPLATES[key],
        body: overrides[key] ?? DEFAULT_TEMPLATES[key].body,
      })),
    [overrides],
  );

  const isCustomized = useCallback(
    (key: ReminderTemplateKey) => overrides[key] !== undefined,
    [overrides],
  );

  return {templates, setBody, resetBody, isCustomized};
}

/** Reminder history for a customer (newest first), reactive. */
export function useReminderHistory(customerId: string): Reminder[] {
  // Select the stable `reminders` reference, then derive the filtered list in a
  // memo. Filtering *inside* the selector returns a new array every render,
  // which makes zustand's useSyncExternalStore loop ("Maximum update depth").
  const reminders = useReminderHistoryStore(s => s.reminders);
  return useMemo(
    () => reminders.filter(r => r.customerId === customerId),
    [reminders, customerId],
  );
}

/** Send a reminder and record it (with its status) in the history. */
export function useSendReminder() {
  const add = useReminderHistoryStore(s => s.add);

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
      return status;
    },
    [add],
  );
}
