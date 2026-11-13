/**
 * G5: the GST sale amount is pre-filled from the item's sale price ×
 * quantity, marked "from item price", and never overwrites a figure the
 * owner typed. An item with no sale price leaves the amount blank.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {AddCreditScreen} from '@features/customers/presentation/screens/AddCreditScreen';
import {useAuthStore} from '@store/auth.store';
import {itemAmount} from './GstInvoiceSection';

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
    {id: 'rice', name: 'Rice bag', type: 'product', salePrice: 120, unit: 'bag', hsnSac: '1006', gstRate: 5},
    {id: 'free', name: 'Sample', type: 'product', salePrice: 0, unit: 'pcs', hsnSac: '1006', gstRate: 5},
  ]}}),
}));

test('itemAmount: price × quantity, or nothing when there is no price or quantity', () => {
  expect(itemAmount(120, '10')).toBe(1200);
  expect(itemAmount(0, '10')).toBeNull();      // no sale price stored: not an invented 0
  expect(itemAmount(undefined, '10')).toBeNull();
  expect(itemAmount(120, '')).toBeNull();
  expect(itemAmount(33.33, '3')).toBe(99.99);
});

const customer = {id: 'c1', fullName: 'Ravi', outstandingAmount: 0, gstNumber: null, creditLimit: null};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <AddCreditScreen navigation={{goBack: jest.fn()} as any} route={{params: {customer}} as any} />
      </QueryClientProvider>,
    );
  });
  // GST invoice? → Yes
  const toggle = r.root.findAll(n => typeof n.props.onChange === 'function' && Array.isArray(n.props.options))[0];
  await act(async () => { toggle.props.onChange(true); });
  return r;
}
const amountInput = (r: ReactTestRenderer) =>
  r.root.findAll(n => n.props.autoFocus === true && typeof n.props.onChange === 'function')[0];
const pick = async (r: ReactTestRenderer, id: string) => {
  const select = r.root.findAll(n => typeof n.props.onSelect === 'function')[0];
  await act(async () => { select.props.onSelect(id); });
};
const typeQuantity = async (r: ReactTestRenderer, q: string) => {
  await act(async () => { r.root.findAll(n => n.props.testID === 'gst-quantity')[0].props.onChangeText(q); });
};
const fromItemShown = (r: ReactTestRenderer) =>
  r.root.findAll(n => n.props.testID === 'amount-from-item' && n.type === Text).length > 0;

beforeEach(() => {
  useAuthStore.setState({business: {gstRegistered: true, gstin: '29AAPFU0939F1ZV'} as any});
});

test('₹120 × 10 pre-fills ₹1,200; a typed ₹1,150 stays when the quantity changes again', async () => {
  const r = await render();
  try {
    await typeQuantity(r, '10');
    await pick(r, 'rice');
    expect(amountInput(r).props.value).toBe(1200);
    expect(fromItemShown(r)).toBe(true);

    await act(async () => { amountInput(r).props.onChange(1150); }); // the owner's own figure
    expect(fromItemShown(r)).toBe(false);
    await typeQuantity(r, '12');
    await pick(r, 'rice');
    expect(amountInput(r).props.value).toBe(1150); // never silently overwritten
  } finally {
    act(() => r.unmount());
  }
});

test('an item with no sale price leaves the amount blank and Save refuses', async () => {
  const r = await render();
  try {
    await typeQuantity(r, '10');
    await pick(r, 'free');
    expect(Number.isNaN(amountInput(r).props.value)).toBe(true);
    expect(fromItemShown(r)).toBe(false);
    const submit = r.root.findAll(n => typeof n.props.onPress === 'function' && n.props.title === 'Add credit')[0];
    await act(async () => { submit.props.onPress(); });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(amountInput(r).props.error).toBeTruthy(); // "enter an amount"
    // Once an amount is typed, it saves.
    await act(async () => { amountInput(r).props.onChange(500); });
    await act(async () => { submit.props.onPress(); });
    expect(mockMutate).toHaveBeenCalled();
  } finally {
    act(() => r.unmount());
  }
});

test('G7: "Paid now in cash" is sent with the GST invoice', async () => {
  mockMutate.mockClear();
  const r = await render();
  try {
    await typeQuantity(r, '10');
    await pick(r, 'rice');
    const paid = r.root.findAll(n => n.props.label === 'Payment' && typeof n.props.onChange === 'function')[0];
    await act(async () => { paid.props.onChange(true); });
    const submit = r.root.findAll(n => typeof n.props.onPress === 'function' && n.props.title === 'Add credit')[0];
    await act(async () => { submit.props.onPress(); });
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({amount: 1200, gst: expect.objectContaining({paidNow: true})}), expect.anything());
  } finally {
    act(() => r.unmount());
  }
});

test('G10: "Save invoice as draft" sends the GST invoice as a draft', async () => {
  mockMutate.mockClear();
  const r = await render();
  try {
    await typeQuantity(r, '10');
    await pick(r, 'rice');
    await act(async () => { r.root.findAll(n => n.props.testID === 'gst-save-draft' && n.props.onPress)[0].props.onPress(); });
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({gst: expect.objectContaining({draft: true})}), expect.anything());
  } finally {
    act(() => r.unmount());
  }
});
