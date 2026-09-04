import {
  ApiError,
  humanizeApiError,
  NetworkError,
  retryDelayMs,
  shouldRetryRequest,
} from './client';

describe('humanizeApiError', () => {
  it('uses a string detail (our raised HTTPExceptions)', () => {
    expect(humanizeApiError({detail: 'Amount must be greater than ₹0.'})).toBe(
      'Amount must be greater than ₹0.',
    );
  });

  it('flattens FastAPI default 422 array detail into readable text', () => {
    const body = {
      detail: [
        {msg: 'field required', loc: ['body', 'amount']},
        {msg: 'value is not a valid float', loc: ['body', 'amount']},
      ],
    };
    expect(humanizeApiError(body)).toBe(
      'field required\nvalue is not a valid float',
    );
  });

  it('falls back to a short raw body, then a generic message', () => {
    expect(humanizeApiError(null, 'Bad Gateway')).toBe('Bad Gateway');
    expect(humanizeApiError(null, null)).toBe(
      'Something went wrong. Please try again.',
    );
    // A huge HTML error page is ignored in favour of the generic message.
    expect(humanizeApiError(null, 'x'.repeat(500))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

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
