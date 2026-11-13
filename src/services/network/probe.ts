import {ENV} from '@config/env';

/**
 * Can this phone get an answer from the server right now (IM2)? A tiny
 * `GET /health`: no login, no ledger data, a 2-second limit. With bars on the
 * screen but nothing getting through (a godown), this fails in 2 s, where the
 * real request would wait out its 15-second timeout before the entry is queued.
 */
export async function probeServer(timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ENV.apiBaseUrl}/health`, {method: 'GET', signal: controller.signal});
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
