import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {ReminderTemplateKey} from '@features/reminders/domain/entities';

interface TemplatesState {
  /** Customized bodies overriding the defaults, keyed by template. */
  overrides: Partial<Record<ReminderTemplateKey, string>>;
  setBody: (key: ReminderTemplateKey, body: string) => void;
  resetBody: (key: ReminderTemplateKey) => void;
}

/** Persisted store of user-customized reminder template bodies. */
export const useReminderTemplatesStore = create<TemplatesState>()(
  persist(
    set => ({
      overrides: {},
      setBody: (key, body) =>
        set(s => ({overrides: {...s.overrides, [key]: body}})),
      resetBody: key =>
        set(s => {
          const {[key]: _removed, ...rest} = s.overrides;
          return {overrides: rest};
        }),
    }),
    {
      name: 'reminder-templates',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
