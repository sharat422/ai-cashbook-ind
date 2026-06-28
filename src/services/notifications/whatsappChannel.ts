import {apiRequest} from '@api/client';
import {ENV} from '@config/env';
import {useAuthStore} from '@store/auth.store';
import type {NotificationChannel} from './types';

/**
 * WhatsApp delivery channel — wired and ready, gated behind `WHATSAPP_ENABLED`.
 *
 * Prepared for later: the app just POSTs the message + recipient to the backend,
 * which owns the WhatsApp Business Cloud API integration (token, phone-number id,
 * approved templates). Until the backend + env flag are in place, the channel
 * reports unavailable and the notification service simply skips it.
 *
 *   POST /api/v1/notifications/whatsapp  { "to": "<mobile>", "message": "<text>" }
 */
export const whatsappChannel: NotificationChannel = {
  id: 'whatsapp',
  label: 'WhatsApp',

  async isAvailable() {
    return ENV.whatsappEnabled && !!useAuthStore.getState().user?.mobile;
  },

  async send(payload) {
    const mobile = useAuthStore.getState().user?.mobile;
    if (!mobile) return;
    await apiRequest('/notifications/whatsapp', {
      method: 'POST',
      body: {to: mobile, message: `${payload.title}\n${payload.body}`},
    });
  },
};
