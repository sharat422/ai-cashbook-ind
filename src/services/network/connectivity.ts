import NetInfo from '@react-native-community/netinfo';

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
   * Subscribe to connectivity changes. Invokes `listener(true)` on
   * (re)connect and `listener(false)` when the connection drops. Returns an
   * unsubscribe function.
   */
  subscribe(listener: (online: boolean) => void): () => void {
    return NetInfo.addEventListener(state => {
      listener(
        Boolean(state.isConnected && state.isInternetReachable !== false),
      );
    });
  },
};
