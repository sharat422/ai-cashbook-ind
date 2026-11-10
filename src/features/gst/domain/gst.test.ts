import {makeLedgerUseCases} from '@features/customers/domain/usecases/ledger';
import {caTestVerdict, gstInputError, isValidGstin} from './gst';

test('GSTIN check digit, HSN and invoice number mirror the server', () => {
  expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
  expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false); // wrong check digit
  expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
  const line = {quantity: '10', uqc: 'BOX'};
  expect(gstInputError({hsn: '1006', ...line})).toBeNull();
  expect(gstInputError({hsn: '12', ...line})?.field).toBe('hsn');
  expect(gstInputError({hsn: '1006', customerGstin: '27AAPFU0939F1ZW', ...line})?.field).toBe('gstin');
  expect(gstInputError({hsn: '1006', uqc: 'BOX'})?.field).toBe('quantity');
  expect(gstInputError({hsn: '1006', quantity: '0', uqc: 'BOX'})?.field).toBe('quantity');
  expect(gstInputError({hsn: '1006', quantity: '2', uqc: 'BOXES'})?.field).toBe('uqc');
});

test('the CA test: zero re-typing passes, over 10% or missing records fails', () => {
  expect(caTestVerdict(20).verdict).toBe('pending');
  expect(caTestVerdict(20, 20, 0).verdict).toBe('pass');
  expect(caTestVerdict(20, 20, 18).verdict).toBe('needs-fixes'); // 18 / 180 = exactly 10%
  expect(caTestVerdict(20, 20, 19)).toEqual({verdict: 'fail', retypedShare: 19 / 180});
  expect(caTestVerdict(20, 19, 0).verdict).toBe('fail');
});

test('a GST sale sends its inputs, never a client-side tax figure', async () => {
  const addEntry = jest.fn().mockResolvedValue({});
  const ledger = makeLedgerUseCases({addEntry, getLedger: jest.fn()});
  const gst = {rate: '18', hsn: '1006', priceIncludesGst: false, customerGstin: '27AAPFU0939F1ZV',
    quantity: '10', uqc: 'BAG'};
  const base = {amount: 1000, date: '2026-01-01'};
  await ledger.addCredit('c', {...base, invoiceNumber: 'A-1', gst});
  // The server numbers GST invoices; the app never sends its own number.
  expect(addEntry).toHaveBeenCalledWith('c', expect.objectContaining({amount: 1000, gst, invoiceNumber: undefined}));
  expect(() => ledger.receivePayment('c', {...base, invoiceNumber: 'A-1', gst})).toThrow('not a payment');
});

test('an item unit becomes its GST unit code where it can', () => {
  const {uqcForUnit} = require('./gst');
  expect(uqcForUnit('Box')).toBe('BOX');
  expect(uqcForUnit('kg')).toBe('KGS');
  expect(uqcForUnit('pcs.')).toBe('PCS');
  expect(uqcForUnit('NOS')).toBe('NOS');
  expect(uqcForUnit('handful')).toBeNull();
});
