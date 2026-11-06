import {isUtrMissing} from '@features/customers/domain/ledger';
import {makeLedgerUseCases} from '@features/customers/domain/usecases/ledger';
import {formatMoney, isZero} from './money';

test('money strings are shown exactly, paise included', () => {
  expect(formatMoney('123456.70')).toBe('₹1,23,456.70');
  expect(formatMoney('0.00')).toBe('₹0.00');
  expect(formatMoney('-1200.3')).toBe('−₹1,200.30');
  expect(isZero('0.00')).toBe(true);
  expect(isZero('0.01')).toBe(false);
});

test('a UPI payment needs a UTR; other methods do not', async () => {
  expect(isUtrMissing('upi', undefined)).toBe(true);
  expect(isUtrMissing('upi', '12')).toBe(true);
  expect(isUtrMissing('upi', '4123 4567 8901')).toBe(false);
  expect(isUtrMissing('cash', undefined)).toBe(false);

  const addEntry = jest.fn().mockResolvedValue({});
  const ledger = makeLedgerUseCases({addEntry, getLedger: jest.fn()});
  const base = {amount: 100, date: '2026-01-01', paymentMethod: 'upi' as const};
  expect(() => ledger.receivePayment('c', base)).toThrow('UTR');
  await ledger.receivePayment('c', {...base, referenceNumber: '412345678901', beatId: 'b'});
  expect(addEntry).toHaveBeenCalledWith('c', expect.objectContaining({beatId: 'b', referenceNumber: '412345678901'}));
  // Credit entries are not payments; no UTR asked.
  await ledger.addCredit('c', base);
  expect(addEntry).toHaveBeenCalledTimes(2);
});
