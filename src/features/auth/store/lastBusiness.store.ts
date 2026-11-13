import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

/**
 * AC3: the business each person last chose on THIS phone, kept across logins
 * (every cold start is a fresh OTP login). The picker lists it first. Only ids,
 * no business data.
 */
interface LastBusinessState {
  byUser: Record<string, string>;
  remember: (userId: string, businessId: string) => void;
}

export const useLastBusiness = create<LastBusinessState>()(
  persist(
    set => ({
      byUser: {},
      remember: (userId, businessId) => set(s => ({byUser: {...s.byUser, [userId]: businessId}})),
    }),
    {name: 'last-business', storage: createJSONStorage(() => AsyncStorage)},
  ),
);
