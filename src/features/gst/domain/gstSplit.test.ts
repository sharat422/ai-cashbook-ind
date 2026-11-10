import {gstSplit, placeOfSupply} from './gstSplit';
import vectors from './gstSplitVectors.json';

test('the phone computes exactly what the server does (2,976 server-generated cases)', () => {
  const wrong = (vectors as {amount: string; rate: string; inclusive: boolean; interState: boolean;
    taxable_value: string; cgst: string; sgst: string; igst: string; total: string}[])
    .filter(v => {
      const s = gstSplit(v.amount, v.rate, v.inclusive, v.interState);
      return s.taxableValue !== v.taxable_value || s.cgst !== v.cgst || s.sgst !== v.sgst ||
        s.igst !== v.igst || s.total !== v.total;
    });
  expect(wrong).toEqual([]);
});

test('a number amount is read the way the server reads it', () => {
  expect(gstSplit(1180, '18', true, false)).toEqual(
    {taxableValue: '1000.00', cgst: '90.00', sgst: '90.00', igst: '0.00', total: '1180.00'});
  expect(gstSplit(525.5, '5', true, false).total).toBe('525.50');
});

test('place of supply: customer GSTIN, then their state, then the seller', () => {
  const seller = '29AAACS1234B1Z5';
  expect(placeOfSupply(seller, '27AAPFU0939F1ZV')).toBe('27');
  expect(placeOfSupply(seller, undefined, 'Ladakh')).toBe('38');
  expect(placeOfSupply(seller)).toBe('29');
});

test('an offline GST sale owes the invoice total, not the pre-tax price', () => {
  const {useAuthStore} = require('@store/auth.store');
  const {invoiceTotal} = require('@features/customers/data/ledger.local');
  useAuthStore.setState({business: {id: 'b', gstin: '29AAACS1234B1Z5'}});
  const draft = {type: 'credit', amount: 1000, date: '2026-11-08',
    gst: {rate: '18', hsn: '1006', priceIncludesGst: false, customerGstin: '27AAPFU0939F1ZV'}};
  expect(invoiceTotal(draft)).toBe(1180); // IGST 18% on 1,000
  expect(invoiceTotal({...draft, gst: undefined})).toBe(1000);
  useAuthStore.setState({business: null});
});
