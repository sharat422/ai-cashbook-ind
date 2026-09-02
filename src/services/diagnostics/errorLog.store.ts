import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

/** One recorded failure, kept for the user to view / share when reporting. */
export interface ErrorLogEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Where it happened, e.g. "api GET /customers" or "render". */
  context: string;
  message: string;
  stack?: string;
}

/** Keep only the most recent failures — this is a diagnostic buffer, not storage. */
const MAX_ENTRIES = 50;
/** Collapse identical errors fired in a burst (e.g. React Query retries). */
const DEDUP_WINDOW_MS = 4000;

interface ErrorLogState {
  entries: ErrorLogEntry[];
  log: (context: string, error: unknown, extra?: string) => void;
  clear: () => void;
}

function messageOf(error: unknown, extra?: string): string {
  const base =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return extra ? `${base} — ${extra}` : base;
}

export const useErrorLogStore = create<ErrorLogState>()(
  persist(
    set => ({
      entries: [],
      log: (context, error, extra) =>
        set(state => {
          const message = messageOf(error, extra);
          const now = Date.now();
          const last = state.entries[0];
          // Skip a repeat of the same failure within the dedup window.
          if (
            last &&
            last.context === context &&
            last.message === message &&
            now - Date.parse(last.at) < DEDUP_WINDOW_MS
          ) {
            return state;
          }
          const entry: ErrorLogEntry = {
            id: `err_${now}_${Math.random().toString(36).slice(2, 7)}`,
            at: new Date(now).toISOString(),
            context,
            message,
            stack: error instanceof Error ? error.stack : undefined,
          };
          return {entries: [entry, ...state.entries].slice(0, MAX_ENTRIES)};
        }),
      clear: () => set({entries: []}),
    }),
    {
      name: 'error-log',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({entries}) => ({entries}),
    },
  ),
);

/**
 * Record a failure from anywhere — including non-React code (the API client) —
 * without needing the hook. Never throws (logging must not cause a new error).
 */
export function logError(context: string, error: unknown, extra?: string): void {
  try {
    useErrorLogStore.getState().log(context, error, extra);
  } catch {
    // last resort — a broken logger must not take the app down
  }
}

/** Plain-text dump of the log, for the Share sheet. */
export function formatErrorLog(entries: ErrorLogEntry[]): string {
  if (entries.length === 0) return 'No errors logged.';
  return entries
    .map(e => `[${e.at}] ${e.context}\n${e.message}${e.stack ? `\n${e.stack}` : ''}`)
    .join('\n\n');
}
