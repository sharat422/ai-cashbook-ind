import {ApiError, NetworkError, retryDelayMs, shouldRetryRequest} from './client';

describe('shouldRetryRequest', () => {
  it('retries transient network failures a few times, then gives up', () => {
    const err = new NetworkError();
    expect(shouldRetryRequest(0, err)).toBe(true);
    expect(shouldRetryRequest(1, err)).toBe(true);
    expect(shouldRetryRequest(2, err)).toBe(true);
    expect(shouldRetryRequest(3, err)).toBe(false); // capped
  });

  it('never retries deterministic API errors (403/404/etc.)', () => {
    expect(shouldRetryRequest(0, new ApiError(403, 'forbidden'))).toBe(false);
    expect(shouldRetryRequest(0, new ApiError(404, 'not found'))).toBe(false);
    expect(shouldRetryRequest(0, new ApiError(401, 'unauth'))).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially, capped at 8s', () => {
    expect(retryDelayMs(0)).toBe(1500);
    expect(retryDelayMs(1)).toBe(3000);
    expect(retryDelayMs(2)).toBe(6000);
    expect(retryDelayMs(3)).toBe(8000); // capped
    expect(retryDelayMs(10)).toBe(8000);
  });
});
