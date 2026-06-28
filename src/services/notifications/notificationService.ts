import {inAppChannel} from './inAppChannel';
import type {NotificationChannel, NotificationPayload} from './types';
import {whatsappChannel} from './whatsappChannel';

/**
 * Fans a notification out to every available channel. Channels are independent
 * and best-effort: one failing (e.g. WhatsApp backend down) never blocks the
 * others (e.g. the in-app inbox).
 */
class NotificationService {
  private channels: NotificationChannel[];

  constructor(channels: NotificationChannel[]) {
    this.channels = channels;
  }

  /** Register an additional channel (e.g. OS push) at runtime. */
  register(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  /** Deliver to all available channels; returns the channel ids that accepted. */
  async notify(payload: NotificationPayload): Promise<string[]> {
    const delivered: string[] = [];
    await Promise.all(
      this.channels.map(async channel => {
        try {
          if (!(await channel.isAvailable())) return;
          await channel.send(payload);
          delivered.push(channel.id);
        } catch (err) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.warn(`[notifications] ${channel.id} failed`, err);
          }
        }
      }),
    );
    return delivered;
  }
}

/** App-wide service: in-app inbox today, WhatsApp ready behind a flag. */
export const notificationService = new NotificationService([
  inAppChannel,
  whatsappChannel,
]);
