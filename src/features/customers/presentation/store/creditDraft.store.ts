import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {Attachment} from '@/shared/types/attachment';

/** A saved (unsubmitted) Add-Credit form, persisted per customer. */
export interface CreditDraft {
  amount: number;
  date: string;
  invoiceNumber: string;
  notes: string;
  attachment: Attachment | null;
}

interface CreditDraftState {
  /** Drafts keyed by customer id. */
  drafts: Record<string, CreditDraft>;
  saveDraft: (customerId: string, draft: CreditDraft) => void;
  clearDraft: (customerId: string) => void;
}

/** Persisted store of in-progress credit drafts (survives navigation/restart). */
export const useCreditDraftStore = create<CreditDraftState>()(
  persist(
    set => ({
      drafts: {},
      saveDraft: (customerId, draft) =>
        set(s => ({drafts: {...s.drafts, [customerId]: draft}})),
      clearDraft: customerId =>
        set(s => {
          const {[customerId]: _removed, ...rest} = s.drafts;
          return {drafts: rest};
        }),
    }),
    {
      name: 'credit-drafts',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({drafts}) => ({drafts}),
    },
  ),
);
