import NetInfo from '@react-native-community/netinfo';

import {NetworkError, WeakSignalError} from '@api/client';
import {probeServer} from './probe';

const RETRY_MS = 30_000;
const listeners = new Set<(online: boolean) => void>();
let retry: ReturnType<typeof setInterval> | null = null;

/**
 * After a failed probe, ask again every 30 s; when the server answers, tell the
 * sync managers, as a reconnect would. NetInfo never sees weak signal end, so
 * without this a queued entry would wait for the next app open or "Sync now".
 * ponytail: one global 30-s timer while the signal is weak; nothing runs otherwise.
 */
function retryUntilReachable(): void {
  retry ??= setInterval(() => {
    void probeServer().then(ok => {
      if (!ok || !retry) return;
      clearInterval(retry);
      retry = null;
      listeners.forEach(listener => listener(true));
    });
  }, RETRY_MS);
}

/**
 * Thin wrapper over NetInfo so the rest of the app depends on a small,
 * mockable surface rather than the library directly.
 */
export const connectivity = {
  /** Resolve the current online state. Treats unknown as offline-safe. */
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  },

  /**
   * Call before a save; on a throw, queue the entry (IM2). Offline (airplane
   * mode, Wi-Fi with no internet): NetworkError at once, as before. Otherwise a
   * 2-second probe of the server; if it doesn't answer (weak signal),
   * WeakSignalError: the save is queued now, without trying the real request.
   * If the probe answers but the real request then fails, callers queue as before.
   */
  async beforeSave(): Promise<void> {
    if (!(await connectivity.isOnline())) throw new NetworkError();
    if (!(await probeServer())) {
      retryUntilReachable();
      throw new WeakSignalError();
    }
  },

  /**
   * Subscribe to connectivity changes. Invokes `listener(true)` on
   * (re)connect, or when the server answers again after weak signal, and
   * `listener(false)` when the connection drops. Returns an unsubscribe function.
   */
  subscribe(listener: (online: boolean) => void): () => void {
    listeners.add(listener);
    const off = NetInfo.addEventListener(state => {
      listener(
        Boolean(state.isConnected && state.isInternetReachable !== false),
      );
    });
    return () => {
      listeners.delete(listener);
      off();
    };
  },
};
