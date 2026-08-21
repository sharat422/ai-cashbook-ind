import {toQueryString} from './query';

describe('toQueryString', () => {
  it('builds a query string from mixed values', () => {
    expect(toQueryString({limit: 20, sort: 'date'})).toBe('limit=20&sort=date');
  });

  it('url-encodes keys and values', () => {
    expect(toQueryString({search: 'a b&c'})).toBe('search=a%20b%26c');
  });

  it('skips null, undefined and empty-string values', () => {
    expect(
      toQueryString({a: '1', b: undefined, c: null, d: '', e: 0}),
    ).toBe('a=1&e=0');
  });

  it('returns an empty string when nothing is set', () => {
    expect(toQueryString({a: undefined, b: null, c: ''})).toBe('');
  });

  it('serializes booleans', () => {
    expect(toQueryString({track: true})).toBe('track=true');
  });
});
