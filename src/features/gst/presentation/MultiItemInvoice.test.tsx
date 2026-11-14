/**
 * A GST sale with several items: item 1 is the amount field, item 2… have
 * their own; every item is sent, the sale's amount is their sum, and a
 * problem on item 2 is shown on item 2. Offline, each item is taxed on its
 * own and the split is their sum (as the server does).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {invoiceTotal} from '@features/customers/data/ledger.local';
import {AddCreditScreen} from '@features/customers/presentation/screens/AddCreditScreen';
import {gstSplit, gstSplitLines} from '@features/gst/domain/gstSplit';
import {useAuthStore} from '@store/auth.store';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp', writeFile: jest.fn()}));
jest.mock('react-native-share', () => ({default: {open: jest.fn()}}));
jest.mock('@features/income/presentation/hooks', () => ({useConnectivity: () => false}));
const mockMutate = jest.fn();
jest.mock('@features/customers/presentation/hooks', () => ({
  useLedgerMutations: () => ({addCredit: {mutate: mockMutate, isPending: false}}),
}));
jest.mock('@features/items/presentation/hooks/useItems', () => ({
  useItems: () => ({data: {items: [
    {id: 'soap', name: 'Soap', type: 'product', salePrice: 50, unit: 'pcs', hsnSac: '3401', gstRate: 18},
  ]}}),
}));

const SELLER = '29AAPFU0939F1ZV';
const customer = {id: 'c1', fullName: 'Ravi', outstandingAmount: 0, gstNumber: null, creditLimit: null};

beforeEach(() => {
  mockMutate.mockClear();
  useAuthStore.setState({business: {gstRegistered: true, gstin: SELLER} as any});
});

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <AddCreditScreen navigation={{goBack: jest.fn()} as any} route={{params: {customer}} as any} />
      </QueryClientProvider>,
    );
  });
  const toggle = r.root.findAll(n => typeof n.props.onChange === 'function' && Array.isArray(n.props.options))[0];
  await act(async () => { toggle.props.onChange(true); }); // GST invoice? → Yes
  return r;
}
const byId = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id)[0];
const type = async (r: ReactTestRenderer, id: string, v: string) => {
  await act(async () => { byId(r, id).props.onChangeText(v); });
};
const selects = (r: ReactTestRenderer, label: string) =>
  r.root.findAll(n => typeof n.props.onSelect === 'function' && n.props.label === label);
const press = async (r: ReactTestRenderer, title: string) => {
  const b = r.root.findAll(n => typeof n.props.onPress === 'function' && n.props.title === title)[0];
  await act(async () => { b.props.onPress(); });
};

test('two items: both sent, the amount is their sum, the split is per item', async () => {
  const r = await render();
  try {
    const amount = r.root.findAll(n => n.props.autoFocus === true && typeof n.props.onChange === 'function')[0];
    await act(async () => { amount.props.onChange(1000); });
    await type(r, 'gst-hsn', '1006');
    await type(r, 'gst-quantity', '10');
    await act(async () => { selects(r, 'Unit (UQC)')[0].props.onSelect('BAG'); });
    await press(r, '＋ Add another item');
    expect(byId(r, 'gst-line-2')).toBeTruthy();
    // Item 2 from the catalogue: HSN, rate and unit filled; amount = ₹50 × 4.
    await act(async () => { selects(r, 'Item (fills HSN, rate and unit)')[1].props.onSelect('soap'); });
    await type(r, 'gst-quantity-2', '4');
    expect(byId(r, 'gst-amount-2').props.value).toBe('200');

    await press(r, 'Add credit');
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const sent = mockMutate.mock.calls[0][0];
    expect(sent.amount).toBe(1200);
    expect(sent.gst.lines).toEqual([
      {amount: '1000', rate: '18', hsn: '1006', quantity: '10', uqc: 'BAG'},
      {amount: '200', rate: '18', hsn: '3401', quantity: '4', uqc: 'PCS'},
    ]);
    // Offline balance: what the server will save.
    expect(invoiceTotal({type: 'credit', amount: 1200, date: '2026-11-13', gst: sent.gst})).toBe(1416);
  } finally {
    act(() => r.unmount());
  }
});

test('a missing unit on item 2 is shown on item 2 and nothing is saved; Remove takes it off', async () => {
  const r = await render();
  try {
    const amount = r.root.findAll(n => n.props.autoFocus === true && typeof n.props.onChange === 'function')[0];
    await act(async () => { amount.props.onChange(1000); });
    await type(r, 'gst-hsn', '1006');
    await type(r, 'gst-quantity', '10');
    await act(async () => { selects(r, 'Unit (UQC)')[0].props.onSelect('BAG'); });
    await press(r, '＋ Add another item');
    await type(r, 'gst-hsn-2', '3401');
    await type(r, 'gst-quantity-2', '4');
    await type(r, 'gst-amount-2', '200');
    await press(r, 'Add credit');
    expect(mockMutate).not.toHaveBeenCalled();
    expect(selects(r, 'Unit (UQC)')[1].props.error).toBeTruthy();
    expect(selects(r, 'Unit (UQC)')[0].props.error).toBeFalsy();

    await act(async () => { byId(r, 'gst-line-remove-2').props.onPress(); });
    expect(r.root.findAll(n => n.props.testID === 'gst-line-2')).toHaveLength(0);
    await press(r, 'Add credit');
    expect(mockMutate.mock.calls[0][0].gst.lines).toBeUndefined(); // one item: sent as before
  } finally {
    act(() => r.unmount());
  }
});

test('gstSplitLines: each item rounded on its own, then added', () => {
  const lines = [{amount: '0.05', rate: '18'}, {amount: '0.05', rate: '18'}];
  const one = gstSplit('0.05', '18', false, false);
  expect(one.cgst).toBe('0.00'); // 0.0045 rounds to 0 per item…
  expect(gstSplitLines(lines, false, false).cgst).toBe('0.00'); // …so the sum is 0, not 0.01
  expect(gstSplitLines([{amount: 1000, rate: '5'}, {amount: 500, rate: '18'}], false, true))
    .toEqual({taxableValue: '1500.00', cgst: '0.00', sgst: '0.00', igst: '140.00', total: '1640.00'});
});
