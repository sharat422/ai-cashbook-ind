import {formatINR, groupINR, parseAmount} from './currency';

describe('formatINR', () => {
  it('formats with the rupee symbol and Indian digit grouping', () => {
    expect(formatINR(1234567)).toBe('₹12,34,567');
  });

  it('formats small amounts', () => {
    expect(formatINR(500)).toBe('₹500');
  });

  it('has no paise (whole rupees only)', () => {
    expect(formatINR(99.6)).toBe('₹100');
  });

  it('guards NaN', () => {
    expect(formatINR(NaN)).toBe('₹0');
  });
});

describe('groupINR', () => {
  it('groups digits the Indian way without a symbol', () => {
    expect(groupINR('1234567')).toBe('12,34,567');
  });

  it('returns empty for blank or non-numeric input', () => {
    expect(groupINR('')).toBe('');
    expect(groupINR('abc')).toBe('');
  });
});

describe('parseAmount', () => {
  it('strips formatting back to a number', () => {
    expect(parseAmount('₹12,34,567')).toBe(1234567);
  });

  it('returns NaN when there are no digits', () => {
    expect(Number.isNaN(parseAmount('₹'))).toBe(true);
  });
});
