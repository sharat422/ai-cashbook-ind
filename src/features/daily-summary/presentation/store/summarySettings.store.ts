import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {ENV} from '@config/env';

interface SummarySettingsState {
  /** Whether the daily summary notification is on. */
  enabled: boolean;
  /** Local time the summary fires. */
  hour: number;
  minute: number;
  /** ISO date the summary was last delivered (dedupe — once per day). */
  lastSentDate: string | null;

  setEnabled: (value: boolean) => void;
  setTime: (hour: number, minute: number) => void;
  setLastSentDate: (date: string) => void;
}

/** User preferences for the daily summary notification (persisted). */
export const useSummarySettingsStore = create<SummarySettingsState>()(
  persist(
    set => ({
      enabled: true,
      hour: ENV.dailySummaryDefaultHour,
      minute: 0,
      lastSentDate: null,

      setEnabled: value => set({enabled: value}),
      setTime: (hour, minute) => set({hour, minute}),
      setLastSentDate: date => set({lastSentDate: date}),
    }),
    {
      name: 'summary-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
