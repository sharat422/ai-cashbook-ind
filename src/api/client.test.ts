import {
  ApiError,
  apiErrorMessage,
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

describe('apiErrorMessage (TE3: the reason, by code, in the user language)', () => {
  const {useAuthStore} = require('@store/auth.store');
  const {translate} = require('@/i18n/useT');
  const {useErrorLogStore} = require('@/services/diagnostics/errorLog.store');
  const utr = 'This UTR is already on a UPI payment of ₹500.00 from Ramesh on 05-11-2026. Each UPI payment has its own UTR — check for a typo.';
  const params = {amount: '₹500.00', customer: 'Ramesh', date: '05-11-2026'};
  afterEach(() => useAuthStore.setState({preferredLanguage: 'en'}));

  it('English keeps the server sentence; Telugu gets the translated reason naming the same values', () => {
    useAuthStore.setState({preferredLanguage: 'en'});
    expect(apiErrorMessage(409, utr, 'duplicate_utr', params)).toBe(utr);
    useAuthStore.setState({preferredLanguage: 'te'});
    const te = apiErrorMessage(409, utr, 'duplicate_utr', params);
    expect(te).toBe(translate('te', 'errors.code.duplicate_utr' as never, params));
    expect(te).toContain('₹500.00');
    expect(te).toContain('Ramesh');
    expect(te).not.toBe(translate('te', 'errors.checkInput'));
  });

  it('a locked invoice names its number in Telugu, not just "check the details"', () => {
    useAuthStore.setState({preferredLanguage: 'te'});
    const msg = apiErrorMessage(422, 'Invoice 26-27/00007 is issued and locked.', 'invoice_locked', {number: '26-27/00007'});
    expect(msg).toContain('26-27/00007');
    expect(msg).not.toBe(translate('te', 'errors.checkInput'));
  });

  it('a kind code gets the sentence for its kind', () => {
    useAuthStore.setState({preferredLanguage: 'te'});
    expect(apiErrorMessage(404, 'Bill not found', 'not_found')).toBe(translate('te', 'errors.notFound'));
  });

  it('a code with no translation falls back to the English reason and is logged once', () => {
    useAuthStore.setState({preferredLanguage: 'te'});
    useErrorLogStore.setState({entries: []});
    const detail = 'Something specific the app has never seen.';
    expect(apiErrorMessage(422, detail, 'brand_new_code', {})).toBe(detail);
    apiErrorMessage(422, detail, 'brand_new_code', {});
    const logged = useErrorLogStore.getState().entries.filter(
      (e: {message: string}) => e.message.includes('brand_new_code'));
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toContain('No te translation for error code "brand_new_code"');
  });

  it('a response with no code (a host error page) gets the sentence for its status', () => {
    useAuthStore.setState({preferredLanguage: 'te'});
    expect(apiErrorMessage(502, 'Bad gateway')).toBe(translate('te', 'errors.server'));
  });
});
