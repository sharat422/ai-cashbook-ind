/**
 * Domain entities for the Reminder Management module. Pure types — no framework
 * imports.
 */

export type ReminderChannel = 'whatsapp' | 'sms' | 'push';

export const CHANNEL_LABEL: Record<ReminderChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  push: 'Push',
};

export const CHANNEL_ICON: Record<ReminderChannel, string> = {
  whatsapp: '🟢',
  sms: '💬',
  push: '🔔',
};

export type ReminderTemplateKey = 'friendly' | 'due' | 'overdue' | 'final';

export interface ReminderTemplate {
  key: ReminderTemplateKey;
  name: string;
  /** Body with {name}, {amount}, {business} placeholders. */
  body: string;
}

/** Values substituted into a template. */
export interface ReminderVars {
  name: string;
  amount: string;
  business: string;
}

/** Delivery outcome we can observe from the client. */
export type ReminderStatus = 'sent' | 'failed' | 'pending';

/** A recorded reminder (history + status tracking). */
export interface Reminder {
  id: string;
  customerId: string;
  channel: ReminderChannel;
  templateKey: ReminderTemplateKey;
  message: string;
  status: ReminderStatus;
  createdAt: string;
}
