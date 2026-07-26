import {formatDisplayDate, toISODate} from './date';

describe('toISODate', () => {
  it('formats a Date as YYYY-MM-DD (local), zero-padded', () => {
    // Month is 0-indexed: 5 => June.
    expect(toISODate(new Date(2026, 5, 7))).toBe('2026-06-07');
  });
});

describe('formatDisplayDate', () => {
  it('renders a friendly day/month/year', () => {
    expect(formatDisplayDate('2026-06-14')).toBe('14 Jun 2026');
  });

  it('returns the input unchanged when it is not a valid date', () => {
    expect(formatDisplayDate('not-a-date')).toBe('not-a-date');
  });
});
