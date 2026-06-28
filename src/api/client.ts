import {API_ROOT, ENV} from '@config/env';
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
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
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
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      // FastAPI conventionally returns {"detail": "..."} on errors.
      const message =
        (data && (data.detail || data.message)) ||
        'Something went wrong. Please try again.';
      throw new ApiError(
        response.status,
        typeof message === 'string' ? message : 'Request failed',
      );
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new NetworkError('Request timed out');
    }
    throw new NetworkError();
  } finally {
    clearTimeout(timeout);
  }
}
