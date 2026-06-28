import RNConfig from 'react-native-config';

/**
 * Typed, validated access to environment variables (loaded by
 * react-native-config from the `.env` file at build time).
 *
 * Keep ALL environment access in this module so the rest of the app depends on
 * a stable, typed surface rather than raw `Config.*` strings.
 */
const Config = RNConfig as Record<string, string | undefined>;

function required(key: string, fallback?: string): string {
  const value = Config[key] ?? fallback;
  if (value === undefined || value === '') {
    // Fail loud in dev; in release the fallback should always be provided.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`[env] Missing required env var: ${key}`);
    }
    return '';
  }
  return value;
}

export const ENV = {
  /**
   * FastAPI base URL.
   * Android emulator reaches host machine via 10.0.2.2; iOS simulator via
   * localhost. Override per environment in `.env`.
   */
  apiBaseUrl: required('API_BASE_URL', 'http://10.0.2.2:8000'),
  apiVersion: required('API_VERSION', 'v1'),
  apiTimeoutMs: Number(Config.API_TIMEOUT_MS ?? 15000),
  /** Page size for paginated lists (e.g. transaction history). */
  transactionsPageSize: Number(Config.TRANSACTIONS_PAGE_SIZE ?? 20),
  /**
   * Timeout for the AI receipt scan request (ms). OCR + AI extraction is slower
   * than a normal API call, so it gets its own, longer budget.
   */
  receiptScanTimeoutMs: Number(Config.RECEIPT_SCAN_TIMEOUT_MS ?? 45000),
  /**
   * Below this confidence the categorization UI flags the result for review.
   */
  categorizationConfidenceThreshold: Number(
    Config.CATEGORIZATION_CONFIDENCE_THRESHOLD ?? 0.6,
  ),
  /** Default hour (0–23, local) for the daily summary notification. */
  dailySummaryDefaultHour: Number(Config.DAILY_SUMMARY_DEFAULT_HOUR ?? 20),
  /**
   * Whether the WhatsApp delivery channel is enabled. Off by default — the
   * channel is wired and ready but only activates once the backend is in place.
   */
  whatsappEnabled:
    (Config.WHATSAPP_ENABLED ?? 'false').toLowerCase() === 'true',
} as const;

/** Fully-qualified API root, e.g. http://10.0.2.2:8000/api/v1 */
export const API_ROOT = `${ENV.apiBaseUrl}/api/${ENV.apiVersion}`;
