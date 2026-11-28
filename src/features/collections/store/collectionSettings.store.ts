import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

interface CollectionSettingsState {
  /** Merchant's UPI ID / VPA used to collect payments (e.g. shop@okhdfcbank). */
  upiId: string;
  /** Payee display name shown in the UPI app (defaults to the business name). */
  payeeName: string;
  setUpi: (upiId: string, payeeName: string) => void;
}

/**
 * A UPI ID kept on this phone from before it moved to the business (Business.upiId,
 * set once by the owner in Settings). Nothing writes one any more: Request Payment
 * uses it only when the business has none (with a warning), and saving the
 * business's UPI ID in Settings clears it.
 */
export const useCollectionSettingsStore = create<CollectionSettingsState>()(
  persist(
    set => ({
      upiId: '',
      payeeName: '',
      setUpi: (upiId, payeeName) =>
        set({upiId: upiId.trim(), payeeName: payeeName.trim()}),
    }),
    {
      name: 'collection-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
