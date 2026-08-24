import {cashTotal, subtotal, totalPieces} from './denominations';

describe('cash counter', () => {
  it('totals the worked example (₹7,000)', () => {
    const counts = {500: 10, 200: 5, 100: 8, 50: 4};
    expect(cashTotal(counts)).toBe(7000);
  });

  it('counts pieces', () => {
    expect(totalPieces({500: 10, 100: 8})).toBe(18);
  });

  it('subtotal multiplies denom × count', () => {
    expect(subtotal(500, 10)).toBe(5000);
    expect(subtotal(50, 0)).toBe(0);
  });

  it('ignores missing denominations', () => {
    expect(cashTotal({})).toBe(0);
    expect(cashTotal({100: 3})).toBe(300);
  });
});
