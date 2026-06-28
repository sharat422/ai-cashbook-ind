import type {
  ReminderTemplate,
  ReminderTemplateKey,
  ReminderVars,
} from './entities';

/** Display order of the four built-in templates (escalating in tone). */
export const TEMPLATE_ORDER: ReminderTemplateKey[] = [
  'friendly',
  'due',
  'overdue',
  'final',
];

/** Built-in templates. Bodies use {name}, {amount}, {business} placeholders. */
export const DEFAULT_TEMPLATES: Record<ReminderTemplateKey, ReminderTemplate> = {
  friendly: {
    key: 'friendly',
    name: 'Friendly Reminder',
    body: 'Hi {name}, just a gentle reminder that {amount} is pending on your account. Whenever convenient is perfectly fine. Thank you! — {business}',
  },
  due: {
    key: 'due',
    name: 'Payment Due Reminder',
    body: 'Hi {name}, your payment of {amount} is now due. Kindly arrange to clear it at the earliest. Thank you. — {business}',
  },
  overdue: {
    key: 'overdue',
    name: 'Overdue Reminder',
    body: 'Hi {name}, your payment of {amount} is overdue. Please clear the outstanding amount to avoid any disruption. — {business}',
  },
  final: {
    key: 'final',
    name: 'Final Reminder',
    body: 'Hi {name}, this is a final reminder for the overdue amount of {amount}. Please clear it immediately to avoid further action. — {business}',
  },
};

/** The placeholders users can insert when customizing a template. */
export const TEMPLATE_PLACEHOLDERS = ['{name}', '{amount}', '{business}'];

/** Substitute the placeholders in a template body. */
export function renderTemplate(body: string, vars: ReminderVars): string {
  return body
    .replace(/\{name\}/g, vars.name)
    .replace(/\{amount\}/g, vars.amount)
    .replace(/\{business\}/g, vars.business);
}
