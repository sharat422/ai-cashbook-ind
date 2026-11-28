import AsyncStorage from '@react-native-async-storage/async-storage';
import {useEffect} from 'react';
import {AppState} from 'react-native';

import {PERMISSIONS, roleCan} from '@features/auth/rbac';
import {recurringRemote} from '@features/recurring/data/recurring.remote';
import {tNow} from '@/i18n';
import {notificationService} from '@/services/notifications';
import {useAuthStore} from '@store/auth.store';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

/** Per template, the auto-post this phone has already told the owner about. */
const SEEN_KEY = 'recurring-autopost-seen';
const CHECK_INTERVAL_MS = 15 * 60_000;
/** Older auto-posts (a reinstall, a new phone) aren't news any more. */
const RECENT_MS = 7 * 86_400_000;

/**
 * The scheduled job posts recurring expenses and income on the server, with no
 * phone involved. The owner hears about each one here: an in-app notification
 * (the 🔔 inbox) the next time the app is open. Safe to call repeatedly.
 */
export async function notifyAutoPosts(now: number = Date.now()): Promise<number> {
  const {token, business} = useAuthStore.getState();
  if (!token || !business || !roleCan(business.role ?? 'owner', PERMISSIONS.SETTINGS_MANAGE)) return 0;
  let items;
  try {
    items = (await recurringRemote.list()).items;
  } catch {
    return 0; // offline: next time
  }
  const seen: Record<string, string> = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? '{}');
  const fresh = items.filter(r => r.lastAutoPostedAt && r.lastAutoPostedAt !== seen[r.id]
    && now - Date.parse(r.lastAutoPostedAt) < RECENT_MS);
  for (const r of fresh) {
    await notificationService.notify({
      title: tNow('recurring.autoPostedTitle', {name: r.name}),
      body: tNow(r.kind === 'income' ? 'recurring.autoPostedIncome' : 'recurring.autoPostedExpense', {
        amount: formatINR(r.amount), date: r.lastPostedDate ? formatDisplayDate(r.lastPostedDate) : ''}),
      data: {type: 'recurring-auto-post', id: r.id},
    });
  }
  if (fresh.length) {
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(
      {...seen, ...Object.fromEntries(fresh.map(r => [r.id, r.lastAutoPostedAt as string]))}));
  }
  return fresh.length;
}

/** Headless: checks on launch, on every foreground and every 15 minutes while open. */
export function RecurringAutoPostNotifier(): null {
  useEffect(() => {
    void notifyAutoPosts();
    const interval = setInterval(() => void notifyAutoPosts(), CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void notifyAutoPosts();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);
  return null;
}
