/** A message to deliver through one or more channels. */
export interface NotificationPayload {
  title: string;
  body: string;
  /** Arbitrary metadata (e.g. {type: 'daily-summary', date}). */
  data?: Record<string, unknown>;
}

/** A notification stored in the in-app inbox. */
export interface AppNotification extends NotificationPayload {
  id: string;
  createdAt: string;
  read: boolean;
}

/**
 * A delivery channel. New channels (push, WhatsApp, email…) implement this
 * interface and register with the notification service — nothing else changes.
 */
export interface NotificationChannel {
  id: string;
  label: string;
  /** Whether this channel can deliver right now (configured + permitted). */
  isAvailable(): Promise<boolean>;
  send(payload: NotificationPayload): Promise<void>;
}
