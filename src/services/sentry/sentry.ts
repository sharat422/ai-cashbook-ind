import * as Sentry from '@sentry/react-native';

import {ENV} from '@/config/env';
import {logError} from '@/services/diagnostics/errorLog.store';

/**
 * Sentry crash reporting (P12).
 *
 * Additive to the local diagnostics error log — that stays as the on-device
 * record; Sentry is the field-visibility layer. Sentry only initializes when
 * a DSN is baked in at build time (`SENTRY_DSN` in `.env`); dev builds and
 * any build without a DSN run with Sentry fully disabled.
 *
 * PRIVACY: this is a finance app. `beforeSend` scrubs anything that looks
 * like a phone number or a rupee amount from messages, exception values and
 * breadcrumbs. Never attach transaction payloads, phone numbers or business
 * names to Sentry events — keep that data in the local error log only.
 */

const PHONE_RE = /(\+?91[\s-]?)?[6789]\d{9}/g;
const RUPEE_RE = /₹\s?[\d,]+(\.\d{1,2})?/g;

function scrubText(value: string): string {
  return value.replace(PHONE_RE, '[PHONE]').replace(RUPEE_RE, '[AMOUNT]');
}

function scrubEvent(
  event: Sentry.ErrorEvent,
): Sentry.ErrorEvent | null {
  try {
    if (event.message) {
      event.message = scrubText(event.message);
    }
    for (const ex of event.exception?.values ?? []) {
      if (ex.value) {
        ex.value = scrubText(ex.value);
      }
    }
    for (const crumb of event.breadcrumbs ?? []) {
      if (crumb.message) {
        crumb.message = scrubText(crumb.message);
      }
    }
    return event;
  } catch {
    // Scrubbing must never drop a crash report.
    return event;
  }
}

let initialized = false;

/** Call once from `index.js` before `AppRegistry.registerComponent`. */
export function initSentry(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const dsn = ENV.sentryDsn.trim();
  if (__DEV__ || dsn === '') {
    // Dev builds and DSN-less builds: Sentry stays completely off.
    return;
  }

  Sentry.init({
    dsn,
    // Crash reporting only for now — no performance tracing.
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    // Never auto-attach PII-ish context.
    sendDefaultPii: false,
  });
}

/**
 * Report a non-fatal error to both Sentry (when enabled) and the local
 * diagnostics error log. Prefer this over raw `Sentry.captureException`
 * so the on-device log stays complete.
 */
export function reportError(context: string, error: unknown): void {
  logError(context, error);
  try {
    if (initialized && ENV.sentryDsn.trim() !== '') {
      Sentry.captureException(error, {tags: {context}});
    }
  } catch {
    // Reporting must never throw.
  }
}
