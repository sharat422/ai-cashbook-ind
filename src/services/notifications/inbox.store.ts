import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {AppNotification, NotificationPayload} from './types';

const MAX_NOTIFICATIONS = 50;

interface InboxState {
  notifications: AppNotification[];
  add: (payload: NotificationPayload) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

/** Persisted in-app notification inbox (the default delivery channel's store). */
export const useInboxStore = create<InboxState>()(
  persist(
    set => ({
      notifications: [],

      add: payload =>
        set(state => ({
          notifications: [
            {
              ...payload,
              id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              createdAt: new Date().toISOString(),
              read: false,
            },
            ...state.notifications,
          ].slice(0, MAX_NOTIFICATIONS),
        })),

      markRead: id =>
        set(state => ({
          notifications: state.notifications.map(n =>
            n.id === id ? {...n, read: true} : n,
          ),
        })),

      markAllRead: () =>
        set(state => ({
          notifications: state.notifications.map(n => ({...n, read: true})),
        })),

      clear: () => set({notifications: []}),
    }),
    {
      name: 'notifications-inbox',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({notifications}) => ({notifications}),
    },
  ),
);

/** Unread count — drives the bell badge. */
export const useUnreadCount = (): number =>
  useInboxStore(state => state.notifications.filter(n => !n.read).length);
