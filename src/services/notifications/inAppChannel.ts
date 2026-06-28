import {useInboxStore} from './inbox.store';
import type {NotificationChannel} from './types';

/**
 * Default channel — delivers into the persisted in-app inbox (the bell). Always
 * available; no native permissions required. A real OS push/local-notification
 * channel can be added later as a second channel without touching this one.
 */
export const inAppChannel: NotificationChannel = {
  id: 'in-app',
  label: 'In-app',
  async isAvailable() {
    return true;
  },
  async send(payload) {
    useInboxStore.getState().add(payload);
  },
};
