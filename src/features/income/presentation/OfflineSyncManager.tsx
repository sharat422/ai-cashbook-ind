import {useIncomeSync} from './hooks/useIncomeSync';

/**
 * Headless component: mount once near the app root to keep the offline income
 * queue syncing in the background. Renders nothing.
 */
export function OfflineSyncManager(): null {
  useIncomeSync();
  return null;
}
