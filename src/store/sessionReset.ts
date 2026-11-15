import AsyncStorage from '@react-native-async-storage/async-storage';
import {useEffect, useRef} from 'react';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {useVisitQueue} from '@features/beats/data/visitQueue';
import {useCategorizationStore} from '@features/categorization/presentation/store/categorization.store';
import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {useCreditLimitStore} from '@features/customer-intel/store/creditLimit.store';
import {useCreditDraftStore} from '@features/customers/presentation/store/creditDraft.store';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {useSummarySettingsStore} from '@features/daily-summary/presentation/store/summarySettings.store';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useReminderHistoryStore} from '@features/reminders/presentation/store/reminderHistory.store';
import {useReminderTemplatesStore} from '@features/reminders/presentation/store/reminderTemplates.store';
import {useCustomerEdits} from '@features/sync/customerEdits';
import {useInboxStore} from '@/services/notifications/inbox.store';
import {useAuthStore} from '@store/auth.store';

/**
 * Wipe every device-local store that holds *business-scoped* data.
 *
 * These zustand stores persist to AsyncStorage device-wide and are not keyed by
 * business, so without this a second business (or a different user on the same
 * phone) would see the previous one's entries, drafts, UPI details and
 * notifications — and, worse, a queued income/ledger draft could sync into the
 * wrong business. `set` merges, so we only reset data fields; actions and the
 * `hydrated` flag are preserved and the persist middleware writes the cleared
 * state back to disk.
 *
 * Device-level preferences (app-lock PIN, notification time) are intentionally
 * left untouched — they belong to the phone, not the business.
 */
export function resetBusinessData(): void {
  useIncomeStore.setState({entries: [], queue: [], isSyncing: false, lastSyncedAt: null});
  useExpenseStore.setState({entries: [], queue: [], isSyncing: false, lastSyncedAt: null});
  usePendingLedgerStore.setState({entries: [], cached: {}, customers: {}});
  useCreditDraftStore.setState({drafts: {}});
  useCreditLimitStore.setState({limits: {}});
  useVisitQueue.setState({pending: []});
  useCustomerEdits.setState({pending: [], conflicts: []});
  useCategorizationStore.setState({decisions: []});
  useCollectionSettingsStore.setState({upiId: '', payeeName: ''});
  useReminderHistoryStore.setState({reminders: []});
  useReminderTemplatesStore.setState({overrides: {}});
  useSummarySettingsStore.setState({lastSentDate: null});
  useInboxStore.setState({notifications: []});
}

/**
 * Which business the local data on this phone belongs to. Kept across app
 * restarts: every start is a fresh login, and entries waiting to sync stay on
 * the phone in between, so the next login must know whose they are.
 */
export const useLocalDataOwner = create<{businessId: string | null; setBusinessId: (id: string) => void}>()(
  persist(
    set => ({businessId: null, setBusinessId: businessId => set({businessId})}),
    {name: 'local-data-owner', storage: createJSONStorage(() => AsyncStorage)},
  ),
);

/**
 * Clears business-scoped local data whenever another business takes over the
 * phone: on logout (id → null), on an account switch, and at a login to a
 * different business than the one whose data is on the phone — e.g. the
 * owner closed the app with entries waiting to sync and someone else logs in
 * next (without this they'd sync into that person's business). A login back to
 * the same business keeps its waiting entries, so they sync.
 */
export function useSessionDataReset(): void {
  const businessId = useAuthStore(s => s.business?.id ?? null);
  const previousId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const previous = previousId.current;
    previousId.current = businessId;
    if (businessId) {
      const owner = useLocalDataOwner.getState().businessId;
      if (owner && owner !== businessId) resetBusinessData();
      useLocalDataOwner.getState().setBusinessId(businessId);
    } else if (previous) {
      resetBusinessData(); // logout: leaving a real business
    }
  }, [businessId]);
}
