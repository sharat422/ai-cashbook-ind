import {Dimensions, Platform} from 'react-native';

import {APP_CONFIG} from '@config/constants';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useAuthStore} from '@store/auth.store';
import {useErrorLogStore} from './errorLog.store';

export interface Diagnostics {
  appVersion: string;
  platform: string;
  osVersion: string | number;
  screen: string;
  language: string;
  role: string;
  pendingSync: number;
  recentErrors: {at: string; context: string; message: string}[];
  at: string;
}

/**
 * Snapshot of device/app state to attach to a bug report — gathered from JS
 * (no native device-info module, so no rebuild). Deliberately excludes anything
 * sensitive (no auth token, PII, or request bodies).
 */
export function collectDiagnostics(): Diagnostics {
  const {width, height} = Dimensions.get('window');
  const auth = useAuthStore.getState();
  const pendingSync =
    useIncomeStore.getState().queue.length +
    useExpenseStore.getState().queue.length;
  const recentErrors = useErrorLogStore
    .getState()
    .entries.slice(0, 10)
    .map(e => ({at: e.at, context: e.context, message: e.message}));

  return {
    appVersion: APP_CONFIG.version,
    platform: Platform.OS,
    osVersion: Platform.Version,
    screen: `${Math.round(width)}×${Math.round(height)}`,
    language: auth.preferredLanguage,
    role: auth.business?.role ?? 'owner',
    pendingSync,
    recentErrors,
    at: new Date().toISOString(),
  };
}

/** Human-readable form for an email/WhatsApp fallback body. */
export function formatDiagnostics(d: Diagnostics): string {
  const lines = [
    `App: ${APP_CONFIG.name} v${d.appVersion}`,
    `Platform: ${d.platform} ${d.osVersion}`,
    `Screen: ${d.screen}`,
    `Language: ${d.language} · Role: ${d.role}`,
    `Pending sync: ${d.pendingSync}`,
    `Time: ${d.at}`,
  ];
  if (d.recentErrors.length) {
    lines.push('', 'Recent errors:');
    for (const e of d.recentErrors) {
      lines.push(`• [${e.context}] ${e.message}`);
    }
  }
  return lines.join('\n');
}
