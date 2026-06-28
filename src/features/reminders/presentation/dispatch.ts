import {Linking, Platform} from 'react-native';

import {notificationService} from '@/services/notifications';
import type {
  ReminderChannel,
  ReminderStatus,
} from '@features/reminders/domain/entities';

interface DispatchArgs {
  channel: ReminderChannel;
  customerName: string;
  mobile: string;
  message: string;
}

/**
 * Deliver a reminder over the chosen channel and report the observable status.
 *
 * - **WhatsApp / SMS**: deep-link the customer's chat pre-filled with the text
 *   (WhatsApp falls back to SMS if not installed). We can confirm dispatch, not
 *   the customer's eventual read — so a successful hand-off is `sent`.
 * - **Push**: routed through the app's notification service (in-app inbox now;
 *   the WhatsApp backend channel once enabled).
 */
export async function dispatchReminder({
  channel,
  customerName,
  mobile,
  message,
}: DispatchArgs): Promise<ReminderStatus> {
  const text = encodeURIComponent(message);
  try {
    if (channel === 'whatsapp') {
      const wa = `whatsapp://send?phone=91${mobile}&text=${text}`;
      const canWa = await Linking.canOpenURL(wa);
      await Linking.openURL(canWa ? wa : smsUrl(mobile, text));
      return 'sent';
    }
    if (channel === 'sms') {
      await Linking.openURL(smsUrl(mobile, text));
      return 'sent';
    }
    // push
    await notificationService.notify({
      title: `Reminder · ${customerName}`,
      body: message,
      data: {type: 'reminder'},
    });
    return 'sent';
  } catch {
    return 'failed';
  }
}

function smsUrl(mobile: string, encodedText: string): string {
  const sep = Platform.OS === 'ios' ? '&' : '?';
  return `sms:${mobile}${sep}body=${encodedText}`;
}
