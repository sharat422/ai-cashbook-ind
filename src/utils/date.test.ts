import {endOfTodayIST, formatDisplayDate, nowIST, todayIST, toISODate} from './date';

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

describe("India's today on a phone outside India", () => {
  afterEach(() => jest.useRealTimers());

  test('a US evening is already the next day in India: pickers and presets use that day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-15T20:00:00-05:00')); // 06:30 on 16 Nov in India
    expect(todayIST()).toBe('2026-11-16');
    expect(toISODate(nowIST())).toBe('2026-11-16'); // "Today" in Reports, Khata…
    // The date picker's latest day is India's today, so 16 Nov can be picked…
    expect(endOfTodayIST().getTime()).toBeGreaterThanOrEqual(new Date('2026-11-16T00:00:00').getTime());
    // …but not the day after.
    expect(endOfTodayIST().getTime()).toBeLessThan(new Date('2026-11-17T00:00:00').getTime());
  });
});
