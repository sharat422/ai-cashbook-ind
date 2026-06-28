import {useEffect} from 'react';
import {AppState} from 'react-native';

import {maybeSendDailySummary} from './dispatch';

/** Re-check cadence while the app is in the foreground (ms). */
const CHECK_INTERVAL_MS = 60_000;

/**
 * Headless scheduler: while the app is open it checks once a minute (and on
 * every foreground) whether today's summary is due, and dispatches it once.
 *
 * This covers the "app is running" case. True background delivery (app closed)
 * needs an OS-level scheduler or a backend cron + push — see the module doc.
 */
export function DailySummaryManager(): null {
  useEffect(() => {
    void maybeSendDailySummary();

    const interval = setInterval(() => void maybeSendDailySummary(), CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener('change', status => {
      if (status === 'active') void maybeSendDailySummary();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return null;
}
