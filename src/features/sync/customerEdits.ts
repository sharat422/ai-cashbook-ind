import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {ApiError, NetworkError, WeakSignalError} from '@api/client';
import {connectivity} from '@/services/network/connectivity';
import {customerUseCases} from '@features/customers/di';
import type {Customer, CustomerDraft} from '@features/customers/domain/entities';
import {singleFlight} from '@utils/singleFlight';

/** A customer edit made without a connection, sent with the version it was based on. */
export interface PendingCustomerEdit {
  customerId: string;
  draft: CustomerDraft;
  expectedVersion?: number;
  queuedAt: string;
  lastError?: string;
  /** Queued because the server didn't answer a quick check (IM2). */
  weakSignal?: boolean;
}

/** This phone's edit vs. what another device saved first. Waits for a person to choose. */
export interface CustomerConflict {
  customerId: string;
  mine: CustomerDraft;
  theirs: Customer;
  detectedAt: string;
}

interface CustomerEditsState {
  pending: PendingCustomerEdit[];
  conflicts: CustomerConflict[];
}

/** Persisted so a queued edit or an unresolved conflict survives a restart. */
export const useCustomerEdits = create<CustomerEditsState>()(
  persist((): CustomerEditsState => ({pending: [], conflicts: []}), {
    name: 'customer-edits',
    storage: createJSONStorage(() => AsyncStorage),
  }),
);

export const CONFLICT_FIELDS = ['fullName', 'mobile', 'businessName', 'gstNumber', 'address', 'notes'] as const;

const same = (a: CustomerDraft, b: CustomerDraft | Customer) =>
  CONFLICT_FIELDS.every(f => (a[f] ?? '').trim() === (b[f] ?? '').trim());

const set = useCustomerEdits.setState;
const without = <T extends {customerId: string}>(list: T[], id: string) => list.filter(x => x.customerId !== id);

function queue(customerId: string, draft: CustomerDraft, expectedVersion?: number, weakSignal = false) {
  set(s => {
    // A second offline edit replaces the first but keeps the version it started from.
    const earlier = s.pending.find(p => p.customerId === customerId);
    return {
      pending: [
        ...without(s.pending, customerId),
        {customerId, draft, expectedVersion: earlier ? earlier.expectedVersion : expectedVersion,
          queuedAt: new Date().toISOString(), ...(weakSignal ? {weakSignal} : {})},
      ],
    };
  });
}

const isConflict = (err: unknown) => err instanceof ApiError && err.status === 409;

/** Fetch the other device's version and park both for the owner. A lost
 *  response to our own edit also comes back 409 — if the server already holds
 *  exactly our edit there is nothing to choose. */
async function recordConflict(customerId: string, mine: CustomerDraft): Promise<void> {
  const theirs = await customerUseCases.get(customerId);
  set(s => ({
    pending: without(s.pending, customerId),
    conflicts: same(mine, theirs)
      ? without(s.conflicts, customerId)
      : [...without(s.conflicts, customerId), {customerId, mine, theirs, detectedAt: new Date().toISOString()}],
  }));
}

export type SaveResult = 'saved' | 'queued' | 'conflict';

/** Save a customer edit: online now, queued when offline, or parked as a conflict. Never overwrites. */
export async function saveCustomerEdit(
  customerId: string,
  draft: CustomerDraft,
  expectedVersion?: number,
): Promise<SaveResult> {
  if (useCustomerEdits.getState().pending.some(p => p.customerId === customerId)) {
    queue(customerId, draft, expectedVersion); // keep order behind the earlier offline edit
    return 'queued';
  }
  try {
    await connectivity.beforeSave(); // offline or weak signal: queue now (IM2)
    await customerUseCases.update(customerId, draft, expectedVersion);
    return 'saved';
  } catch (err) {
    if (err instanceof NetworkError) {
      queue(customerId, draft, expectedVersion, err instanceof WeakSignalError);
      return 'queued';
    }
    if (!isConflict(err)) throw err;
    try {
      await recordConflict(customerId, draft);
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      queue(customerId, draft, expectedVersion); // decide when we can see their version
      return 'queued';
    }
    return useCustomerEdits.getState().conflicts.some(c => c.customerId === customerId) ? 'conflict' : 'saved';
  }
}

/** Upload queued edits. A stale one becomes a conflict, never an overwrite. */
export const syncCustomerEdits = singleFlight(async (): Promise<number> => {
  let synced = 0;
  for (const edit of [...useCustomerEdits.getState().pending]) {
    try {
      await customerUseCases.update(edit.customerId, edit.draft, edit.expectedVersion);
      set(s => ({pending: without(s.pending, edit.customerId)}));
      synced += 1;
    } catch (err) {
      if (err instanceof NetworkError) break;
      if (isConflict(err)) {
        try {
          await recordConflict(edit.customerId, edit.draft);
          synced += 1;
        } catch (e) {
          if (e instanceof NetworkError) break;
        }
        continue;
      }
      const lastError = err instanceof Error ? err.message : String(err);
      set(s => ({pending: s.pending.map(p => (p.customerId === edit.customerId ? {...p, lastError} : p))}));
    }
  }
  return synced;
});

/**
 * The owner's choice. 'theirs' drops this phone's edit. 'mine' saves it over
 * the version they were shown — if that changed again meanwhile, the conflict
 * is refreshed with the newest version and they choose again.
 */
export async function resolveConflict(
  customerId: string,
  keep: 'mine' | 'theirs',
): Promise<'done' | 'changedAgain'> {
  const conflict = useCustomerEdits.getState().conflicts.find(c => c.customerId === customerId);
  if (!conflict) return 'done';
  if (keep === 'mine') {
    try {
      await customerUseCases.update(customerId, conflict.mine, conflict.theirs.version);
    } catch (err) {
      if (!isConflict(err)) throw err;
      await recordConflict(customerId, conflict.mine);
      return useCustomerEdits.getState().conflicts.some(c => c.customerId === customerId) ? 'changedAgain' : 'done';
    }
  }
  set(s => ({conflicts: without(s.conflicts, customerId)}));
  return 'done';
}
