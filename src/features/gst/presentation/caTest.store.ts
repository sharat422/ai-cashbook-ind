import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

/** What the CA reported after importing a month into Tally. */
export interface CaTestResult {
  imported?: number;
  retyped?: number;
}

interface CaTestState {
  /** Keyed by `${businessId}:${YYYY-MM}`. */
  results: Record<string, CaTestResult>;
  setResult: (key: string, patch: CaTestResult) => void;
}

/** On-device record of the CA test per business and month. */
export const useCaTestStore = create<CaTestState>()(
  persist(
    set => ({
      results: {},
      setResult: (key, patch) =>
        set(s => ({results: {...s.results, [key]: {...s.results[key], ...patch}}})),
    }),
    {
      name: 'gst-ca-test',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({results}) => ({results}),
    },
  ),
);
