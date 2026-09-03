import type {ExpenseDraft} from './entities';
import {validateExpenseDraft} from './validation';

const base: ExpenseDraft = {
  amount: 500,
  category: 'Food',
  date: '2026-01-01',
  vendor: '',
};

describe('validateExpenseDraft', () => {
  it('accepts a quick entry with no vendor (only amount required)', () => {
    expect(validateExpenseDraft(base)).toEqual({});
  });

  it('still requires a valid amount', () => {
    expect(validateExpenseDraft({...base, amount: NaN}).amount).toBeTruthy();
    expect(validateExpenseDraft({...base, amount: 0}).amount).toBeTruthy();
  });

  it('still requires a category', () => {
    expect(
      validateExpenseDraft({...base, category: '' as ExpenseDraft['category']})
        .category,
    ).toBeTruthy();
  });

  it('caps vendor length when one is provided', () => {
    expect(validateExpenseDraft({...base, vendor: 'x'.repeat(81)}).vendor).toBeTruthy();
    expect(validateExpenseDraft({...base, vendor: 'Kirana Store'}).vendor).toBeUndefined();
  });
});
