import {useExpenseSync} from './hooks/useExpenseSync';

/**
 * Headless component: mount once near the app root to keep the offline expense
 * queue syncing in the background. Renders nothing.
 */
export function ExpenseSyncManager(): null {
  useExpenseSync();
  return null;
}
