import {difference, formatQty, isQty, toMilli} from './qty';

test('quantities are exact to 3 decimals, never floats', () => {
  expect(isQty('10')).toBe(true);
  expect(isQty('0.001')).toBe(true);
  expect(isQty('0')).toBe(false);
  expect(isQty('0', true)).toBe(true);
  expect(isQty('1.2345')).toBe(false);
  expect(isQty('abc')).toBe(false);
  expect(toMilli('-1.5')).toBe(-1500);
  // 0.1 + 0.2 style float errors can't happen: 98.5 − 100 is exactly −1.5.
  expect(difference('98.5', '100.000')).toBe('-1.500');
  expect(difference('10.3', '10.1')).toBe('0.200');
  expect(difference('5', '5.000')).toBe('0.000');
});

test('quantities display without trailing zeros', () => {
  expect(formatQty('12.500', 'kg')).toBe('12.5 kg');
  expect(formatQty('-3.000')).toBe('−3');
  expect(formatQty('125000.000', 'box')).toBe('1,25,000 box');
});
