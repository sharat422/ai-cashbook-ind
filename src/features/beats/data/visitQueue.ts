import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {NetworkError} from '@api/client';
import {connectivity} from '@/services/network/connectivity';
import {beatsRemote, type VisitInput} from './beats.remote';

interface PendingVisit extends VisitInput {
  lastError?: string;
}

interface VisitQueueState {
  pending: PendingVisit[];
  enqueue: (visit: VisitInput) => void;
  remove: (clientId: string) => void;
  markFailed: (clientId: string, error: string) => void;
}

/** Visits recorded without a connection, persisted until they reach the server. */
export const useVisitQueue = create<VisitQueueState>()(
  persist(
    set => ({
      pending: [],
      enqueue: visit => set(s => ({pending: [...s.pending, visit]})),
      remove: clientId => set(s => ({pending: s.pending.filter(v => v.clientId !== clientId)})),
      markFailed: (clientId, error) =>
        set(s => ({
          pending: s.pending.map(v => (v.clientId === clientId ? {...v, lastError: error} : v)),
        })),
    }),
    {name: 'pending-visits', storage: createJSONStorage(() => AsyncStorage)},
  ),
);

export function makeVisitClientId(): string {
  return `visit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Save now, or queue on a network failure. Returns false when queued. Real
 *  server errors (validation, 403) are thrown so the sheet can show them. */
export async function saveVisit(visit: VisitInput): Promise<boolean> {
  try {
    if (!(await connectivity.isOnline())) throw new NetworkError(); // queue now, don't wait for a timeout
    await beatsRemote.recordVisit(visit);
    return true;
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    useVisitQueue.getState().enqueue(visit);
    return false;
  }
}

let syncing: Promise<number> | null = null;

/** Upload queued visits. The server dedupes on clientId, so a retry after a
 *  lost response can never create a second visit. Concurrent calls share one run. */
export function syncPendingVisits(): Promise<number> {
  syncing ??= (async () => {
    let synced = 0;
    try {
      if (!(await connectivity.isOnline())) return 0;
      for (const visit of [...useVisitQueue.getState().pending]) {
        try {
          const {clientId, beatId, customerId, outcome, reason, promiseDate, visitedAt} = visit;
          await beatsRemote.recordVisit({clientId, beatId, customerId, outcome, reason, promiseDate, visitedAt});
          useVisitQueue.getState().remove(visit.clientId);
          synced += 1;
        } catch (err) {
          if (err instanceof NetworkError) break; // offline again
          useVisitQueue
            .getState()
            .markFailed(visit.clientId, err instanceof Error ? err.message : 'Sync failed');
        }
      }
      return synced;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
