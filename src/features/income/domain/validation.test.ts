import type {IncomeDraft} from './entities';
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
      'Amount must be greater than ₹0',
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
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(validateIncomeDraft({...valid, date: future}).date).toBe(
      'Date cannot be in the future',
    );
  });

  it('rejects over-long notes', () => {
    expect(validateIncomeDraft({...valid, notes: 'x'.repeat(281)}).notes).toBe(
      'Notes must be 280 characters or fewer',
    );
  });
});
