import {API_ROOT, ENV} from '@config/env';
import {logError} from '@/services/diagnostics/errorLog.store';
import {useAuthStore} from '@store/auth.store';

/** Normalized error thrown by the API client so the UI can show `.message`. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Thrown when a request exceeds ENV.apiTimeoutMs or the device is offline. */
export class NetworkError extends Error {
  constructor(
    message = 'Couldn’t reach the server — it may be waking up. Please try again in a moment.',
  ) {
    super(message);
    this.name = 'NetworkError';
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
 * Thin fetch wrapper for the FastAPI backend: prefixes the API root, injects
 * the auth token, serializes JSON (or passes FormData through untouched for
 * file uploads), applies a timeout, and normalizes errors.
 */
export async function apiRequest<T>(
  path: string,
  {body, headers, timeoutMs, ...options}: RequestOptions = {},
): Promise<T> {
  const token = useAuthStore.getState().token;
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
      // FastAPI conventionally returns {"detail": "..."} on errors.
      const message =
        (data && (data.detail || data.message)) ||
        (text && text.length < 200 ? text : null) ||
        'Something went wrong. Please try again.';
      const apiError = new ApiError(
        response.status,
        typeof message === 'string' ? message : 'Request failed',
      );
      // Log server-side failures (5xx); 4xx are expected and handled by callers.
      if (response.status >= 500) {
        logError(`api ${options.method ?? 'GET'} ${path}`, apiError);
      }
      throw apiError;
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const ctx = `api ${options.method ?? 'GET'} ${path}`;
    if (err instanceof Error && err.name === 'AbortError') {
      const timedOut = new NetworkError(
        'The server took too long to respond (it may be waking up). Please try again.',
      );
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
