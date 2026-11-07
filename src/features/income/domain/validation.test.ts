import type {IncomeDraft} from './entities';
import {istDate} from '@utils/date';
import {validateIncomeDraft} from './validation';

const valid: IncomeDraft = {
  amount: 5000,
  category: 'Sales',
  date: '2020-01-01', // safely in the past
};

describe('validateIncomeDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(validateIncomeDraft(valid)).toEqual({});
  });

  it('rejects a missing/NaN amount', () => {
    expect(validateIncomeDraft({...valid, amount: NaN}).amount).toBe('Enter an amount');
  });

  it('rejects a non-positive amount', () => {
    expect(validateIncomeDraft({...valid, amount: 0}).amount).toBe(
      'Enter an amount greater than ₹0',
    );
  });

  it('rejects an implausibly large amount (> ₹1 crore)', () => {
    expect(validateIncomeDraft({...valid, amount: 10_000_001}).amount).toBe(
      'Amount looks too large',
    );
  });

  it('rejects an unknown category', () => {
    // @ts-expect-error — deliberately invalid category for the test
    expect(validateIncomeDraft({...valid, category: 'Bogus'}).category).toBe(
      'Select a category',
    );
  });

  it('rejects a future date', () => {
    const future = istDate(new Date(Date.now() + 86_400_000)); // tomorrow in India
    expect(validateIncomeDraft({...valid, date: future}).date).toBe(
      'Date cannot be in the future',
    );
  });

  it('rejects over-long notes', () => {
    expect(validateIncomeDraft({...valid, notes: 'x'.repeat(281)}).notes).toBe(
      'Keep it to 280 characters or fewer',
    );
  });
});
