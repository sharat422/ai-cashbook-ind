import {useEffect, useRef} from 'react';

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
  usePendingLedgerStore.setState({entries: []});
  useCreditDraftStore.setState({drafts: {}});
  useCreditLimitStore.setState({limits: {}});
  useCategorizationStore.setState({decisions: []});
  useCollectionSettingsStore.setState({upiId: '', payeeName: ''});
  useReminderHistoryStore.setState({reminders: []});
  useReminderTemplatesStore.setState({overrides: {}});
  useSummarySettingsStore.setState({lastSentDate: null});
  useInboxStore.setState({notifications: []});
}

/**
 * Clears business-scoped local data whenever the active business changes —
 * i.e. on logout (id → null) or when a different business becomes active
 * (account switch / new registration). The first run after mount only *adopts*
 * the current business so a returning user keeps their own offline queue.
 */
export function useSessionDataReset(): void {
  const businessId = useAuthStore(s => s.business?.id ?? null);
  const previousId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previousId.current === undefined) {
      previousId.current = businessId; // adopt on first mount, don't clear
      return;
    }
    if (previousId.current !== businessId) {
      // Only wipe when leaving a real business; going null→id (a fresh login
      // right after a logout that already cleared) needs no second wipe.
      if (previousId.current !== null) resetBusinessData();
      previousId.current = businessId;
    }
  }, [businessId]);
}
