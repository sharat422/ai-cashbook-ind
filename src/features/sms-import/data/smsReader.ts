import {PermissionsAndroid, Platform} from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';

import {
  isLikelyBankSms,
  parseBankSms,
  type ParsedBankSms,
} from '@features/sms-import/domain/bankSms';

/**
 * Reads bank transaction SMS from the device inbox — **Android only**.
 *
 * iOS forbids apps from reading the SMS inbox (sandbox), so on iOS every entry
 * point here degrades to "unsupported" and the UI falls back to pasting a
 * message. Nothing is ever uploaded: messages are parsed on-device and only a
 * user-confirmed transaction is saved.
 *
 * NOTE: READ_SMS is a Play-restricted permission. Shipping the scan path on the
 * Play Store requires a Permissions Declaration exception (see
 * docs/SMS_IMPORT.md). The paste path needs no permission and is store-safe.
 */

export interface RawSms {
  address: string;
  body: string;
  /** Received time, ms since epoch. */
  date: number;
}

export type SmsPermissionResult = 'granted' | 'denied' | 'blocked' | 'unsupported';

export interface ScanResult {
  parsed: ParsedBankSms[];
  /** How many inbox messages were scanned (for "read N messages" feedback). */
  scanned: number;
}

/** True only where inbox reading is possible (Android). */
export function isSmsScanSupported(): boolean {
  return Platform.OS === 'android';
}

/** Ask for READ_SMS at runtime (Android 6+). No-op → 'unsupported' elsewhere. */
export async function requestSmsPermission(): Promise<SmsPermissionResult> {
  if (Platform.OS !== 'android') return 'unsupported';
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    {
      title: 'Read bank SMS',
      message:
        'Smart CashBook reads bank transaction SMS on this device to suggest ' +
        'transactions. Messages are processed on your phone and never uploaded.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  return 'denied';
}

function listSms(filter: Record<string, unknown>): Promise<RawSms[]> {
  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify(filter),
      (fail: string) => reject(new Error(fail || 'Could not read SMS')),
      (_count: number, smsList: string) => {
        try {
          const arr = JSON.parse(smsList) as Array<Partial<RawSms>>;
          resolve(
            arr.map(s => ({
              address: s.address ?? '',
              body: s.body ?? '',
              date: Number(s.date ?? 0),
            })),
          );
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Unreadable SMS payload'));
        }
      },
    );
  });
}

/**
 * Read recent inbox SMS and return only recognisable bank transactions. Assumes
 * permission is already granted; returns an empty result on non-Android.
 */
export async function scanBankSms(opts?: {
  maxCount?: number;
  sinceDays?: number;
}): Promise<ScanResult> {
  if (Platform.OS !== 'android') return {parsed: [], scanned: 0};

  const filter: Record<string, unknown> = {
    box: 'inbox',
    maxCount: opts?.maxCount ?? 100,
  };
  if (opts?.sinceDays) {
    filter.minDate = Date.now() - opts.sinceDays * 86_400_000;
  }

  const messages = await listSms(filter);
  const parsed = messages
    .filter(m => isLikelyBankSms(m.body))
    .map(m => parseBankSms(m.body))
    .filter((p): p is ParsedBankSms => p !== null);

  return {parsed, scanned: messages.length};
}
