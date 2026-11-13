import {API_ROOT, ENV} from '@config/env';
import {logError} from '@/services/diagnostics/errorLog.store';
import {useAuthStore} from '@store/auth.store';
import {tNow, translate, type TKey} from '@/i18n';
import {translations} from '@/i18n/translations';

/** Normalized error thrown by the API client so the UI can show `.message`. */
export class ApiError extends Error {
  status: number;
  /** The server's own (English) wording — for logs and support, not the screen. */
  detail: string;
  /** The server's stable error code (TE3), and the values its sentence names. */
  code?: string;
  params?: Record<string, string>;
  constructor(status: number, message: string, detail: string = message, code?: string,
    params?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.params = params;
  }
}

const STATUS_KEY: Record<number, TKey> = {
  401: 'errors.sessionExpired',
  403: 'errors.notAllowed',
  404: 'errors.notFound',
  409: 'errors.conflict',
  413: 'errors.tooLarge',
  429: 'errors.tooMany',
};

/**
 * What the user reads for a failed request. The server writes its errors in
 * English, so in any other language the screen shows a translated sentence
 * for the status instead — never English-only text. English keeps the
 * server's more specific wording.
 */
/** Codes for an error's KIND (the server's errors.KIND): the generic sentence. */
const KIND_KEY: Record<string, TKey> = {
  not_signed_in: 'errors.sessionExpired',
  not_allowed: 'errors.notAllowed',
  not_found: 'errors.notFound',
  conflict: 'errors.conflict',
  too_large: 'errors.tooLarge',
  too_many_requests: 'errors.tooMany',
  check_details: 'errors.checkInput',
  bad_request: 'errors.checkInput',
  gone: 'errors.notFound',
  server_error: 'errors.server',
  upstream_error: 'errors.server',
  unavailable: 'errors.server',
};

const untranslated = new Set<string>();

/**
 * What the user reads for a failed request (TE3). English keeps the server's
 * own sentence. In any other language: a SPECIFIC code (duplicate_utr,
 * invoice_locked, stock_short_van…) shows its reviewed translation with the
 * same values the English names (the number, the amount); a KIND code
 * (not_found, conflict…) shows the sentence for its kind; a code this app has
 * no translation for falls back to the English reason — more useful than a
 * vague sentence — and is logged once so it can be translated. A response
 * with no code at all (a host's error page) gets the sentence for its status.
 */
export function apiErrorMessage(status: number, detail: string, code?: string,
  params?: Record<string, string>): string {
  const lang = useAuthStore.getState().preferredLanguage;
  if (lang === 'en') return detail;
  if (code) {
    if (KIND_KEY[code]) return translate(lang, KIND_KEY[code]);
    const key = `errors.code.${code}` as TKey;
    if (translations[lang]?.[key]) return translate(lang, key, params);
    if (!untranslated.has(`${lang}:${code}`)) {
      untranslated.add(`${lang}:${code}`);
      logError('i18n', new Error(`No ${lang} translation for error code "${code}"`), detail);
    }
    return detail;
  }
  return translate(lang, STATUS_KEY[status] ?? (status >= 500 ? 'errors.server' : 'errors.checkInput'));
}

/** Thrown when a request exceeds ENV.apiTimeoutMs or the device is offline. */
export class NetworkError extends Error {
  constructor(message = tNow('errors.network')) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** IM2: signal bars, but the server didn't answer a 2-second check before a
 *  save. The entry is queued at once (and shown as "queued — weak signal"). */
export class WeakSignalError extends NetworkError {
  constructor() {
    super();
    this.name = 'WeakSignalError';
  }
}

/**
 * React Query retry predicate. Retries transient network failures (offline
 * blips and the free-tier cold-start connection resets, which can take a boot
 * cycle to clear) a few times, but never retries deterministic API errors
 * (401/403/404/422…) which won't fix themselves.
 */
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return false;
  return failureCount < 3;
}

/** Exponential backoff (ms), capped, so retries span a short cold-start window. */
export function retryDelayMs(attemptIndex: number): number {
  return Math.min(1500 * 2 ** attemptIndex, 8000);
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Plain object (sent as JSON) or FormData (sent as multipart). */
  body?: unknown;
  /** Per-request timeout override (ms); falls back to ENV.apiTimeoutMs. */
  timeoutMs?: number;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

/**
 * Turn a parsed error body into one human sentence.
 *
 * FastAPI uses `{"detail": "..."}` for our raised errors, but its *default*
 * validation 422 uses `{"detail": [{"msg": "...", "loc": [...]}, ...]}`. We
 * convert that array to readable text too, so a validation error never surfaces
 * as the opaque "Request failed". Falls back to a short raw body, then a generic
 * message — the caller always gets a non-empty string.
 */
export function humanizeApiError(
  data: unknown,
  rawText?: string | null,
): string {
  const generic = 'Something went wrong. Please try again.';
  const record = data as {detail?: unknown; message?: unknown} | null;
  const detail = record?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map(d => (typeof d === 'string' ? d : (d as {msg?: string})?.msg))
      .filter((m): m is string => !!m);
    if (msgs.length) return msgs.join('\n');
  }
  if (typeof record?.message === 'string' && record.message.trim()) {
    return record.message;
  }
  if (rawText && rawText.trim() && rawText.length < 200) return rawText;
  return generic;
}

/**
 * Thin fetch wrapper for the FastAPI backend: prefixes the API root, injects
 * the auth token, serializes JSON (or passes FormData through untouched for
 * file uploads), applies a timeout, and normalizes errors.
 */
export async function apiRequest<T>(
  path: string,
  {body, headers, timeoutMs, ...options}: RequestOptions = {},
): Promise<T> {
  const {token, business} = useAuthStore.getState();
  const multipart = isFormData(body);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs ?? ENV.apiTimeoutMs,
  );

  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // Let fetch set the multipart boundary itself — never override it.
        ...(multipart ? {} : {'Content-Type': 'application/json'}),
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
        // Every call is about one business; access is re-checked on the server each time.
        ...(business?.id ? {'X-Business-Id': business.id} : {}),
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : multipart
          ? (body as FormData)
          : JSON.stringify(body),
    });

    const text = await response.text();
    // Some error responses (e.g. a plain-text 500/502 from the host) aren't
    // JSON — parse defensively so they surface as a proper ApiError with the
    // right status, not a misleading "network" failure.
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      // The owner removed this user's access: sign out of the business at once.
      if (response.status === 403 && response.headers?.get?.('x-bolcash-access') === 'revoked') {
        useAuthStore.getState().accessRevoked();
      }
      // FastAPI returns {"detail": ...} on errors (a string for ours, an array
      // for default validation 422) — normalize either into one human sentence.
      const detail = humanizeApiError(data, text);
      const code = typeof data?.code === 'string' ? data.code : undefined;
      const params = data?.params && typeof data.params === 'object' ? data.params : undefined;
      const apiError = new ApiError(
        response.status,
        apiErrorMessage(response.status, detail, code, params),
        detail,
        code,
        params,
      );
      // Log server-side failures (5xx); 4xx are expected and handled by callers.
      if (response.status >= 500) {
        logError(`api ${options.method ?? 'GET'} ${path}`, apiError, detail);
      }
      throw apiError;
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const ctx = `api ${options.method ?? 'GET'} ${path}`;
    if (err instanceof Error && err.name === 'AbortError') {
      const timedOut = new NetworkError(tNow('errors.timeout'));
      logError(ctx, timedOut);
      throw timedOut;
    }
    const netError = new NetworkError();
    logError(ctx, netError, err instanceof Error ? err.message : undefined);
    throw netError;
  } finally {
    clearTimeout(timeout);
  }
}
