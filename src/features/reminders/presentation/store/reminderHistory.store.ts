import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {Reminder} from '@features/reminders/domain/entities';

const MAX_HISTORY = 200;

interface HistoryState {
  /** All reminders, newest first. */
  reminders: Reminder[];
  add: (reminder: Reminder) => void;
  clearForCustomer: (customerId: string) => void;
}

/** Persisted reminder history + status log. */
export const useReminderHistoryStore = create<HistoryState>()(
  persist(
    set => ({
      reminders: [],
      add: reminder =>
        set(s => ({
          reminders: [reminder, ...s.reminders].slice(0, MAX_HISTORY),
        })),
      clearForCustomer: customerId =>
        set(s => ({
          reminders: s.reminders.filter(r => r.customerId !== customerId),
        })),
    }),
    {
      name: 'reminder-history',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
