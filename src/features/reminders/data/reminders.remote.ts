import {apiRequest} from '@api/client';

/**
 * Server reminders (backend/app/reminders.py):
 *   GET  /reminders?customerId=&beatId=  the shared history (staff: their beats)
 *   POST /reminders                       a reminder sent by hand, for that history
 *   GET  /reminders/due?beatId=           who needs chasing today, by the owner's rules
 *   GET/PUT /reminders/rules              the owner's rules
 */
export interface ServerReminder {
  id: string;
  customerId: string;
  customerName: string | null;
  /** whatsapp_server: the automatic WhatsApp statement; whatsapp / sms: sent from a phone. */
  channel: 'whatsapp_server' | 'whatsapp' | 'sms';
  reason: 'promise' | 'overdue' | 'manual';
  status: 'sent' | 'failed';
  message: string | null;
  note: string | null;
  automatic: boolean;
  sentByName: string | null;
  createdAt: string;
}

export interface DueReminder {
  customerId: string;
  fullName: string;
  mobile: string;
  outstandingAmount: number;
  reason: 'promise' | 'overdue';
  /** Overdue: days past the 30-day mark (null when it's a missed promise). */
  daysOverdue?: number | null;
  promiseDate?: string | null;
  promiseAmount?: number | null;
  lastReminderAt: string | null;
  /** Agreed to WhatsApp statements: the automatic reminder can reach them. */
  optedIn: boolean;
}

export interface ReminderRules {
  enabled: boolean;
  /** Remind this many days before a promise date (null: off). */
  beforePromiseDays: number | null;
  /** Remind when dues are this many days past the 30-day mark (null: off). */
  overdueDays: number | null;
  repeatDays: number;
  /** One beat's retailers, or everyone (null). */
  beatId: string | null;
}

export const remindersRemote = {
  history: (customerId: string) =>
    apiRequest<ServerReminder[]>(`/reminders?customerId=${encodeURIComponent(customerId)}`, {method: 'GET'}),
  record: (body: {customerId: string; channel: 'whatsapp' | 'sms'; message: string}) =>
    apiRequest<ServerReminder>('/reminders', {method: 'POST', body}),
  due: (beatId?: string) =>
    apiRequest<{auto: boolean; items: DueReminder[]}>(
      `/reminders/due${beatId ? `?beatId=${encodeURIComponent(beatId)}` : ''}`, {method: 'GET'}),
  rules: () => apiRequest<ReminderRules>('/reminders/rules', {method: 'GET'}),
  saveRules: (body: ReminderRules) => apiRequest<ReminderRules>('/reminders/rules', {method: 'PUT', body}),
};
