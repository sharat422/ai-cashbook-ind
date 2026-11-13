/**
 * S2 on the phone: Stock → Move picks a source (godown or a van with stock)
 * and a different destination; staff move only out of their own van, back to
 * the godown.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {StockMoveSheet} from './StockMoveSheet';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp', writeFile: jest.fn()}));
jest.mock('react-native-share', () => ({default: {open: jest.fn()}}));
const mockTransfer = jest.fn();
const mockRecord = jest.fn();
jest.mock('@features/stock/presentation/hooks', () => ({
  makeStockClientId: () => 'cid-1',
  useStockMutations: () => ({record: {mutate: mockRecord, isPending: false},
    transfer: {mutate: mockTransfer, isPending: false}}),
}));
jest.mock('@features/stock/data/stock.remote', () => ({
  stockRemote: {suppliers: async () => [{id: 'sup1', name: 'Sharma Traders', phone: null, gstin: null},
    {id: 'sup2', name: 'Gupta & Sons', phone: null, gstin: null}]},
}));

const wrap = (el: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>
);

const vans = [
  {userId: 'ravi', mobile: '9000000001', role: 'staff', name: 'Ravi'},
  {userId: 'sita', mobile: '9000000002', role: 'staff', name: 'Sita'},
];
const item = {id: 'soap', name: 'Soap', unit: 'box', godown: '20.000', vanQty: {ravi: '30.000'}};

const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => { r.root.findAll(n => n.props.testID === id && n.props.onPress)[0].props.onPress(); });
};
const ids = (r: ReactTestRenderer, prefix: string) =>
  [...new Set(r.root.findAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith(prefix))
    .map(n => n.props.testID))];
const typeQty = async (r: ReactTestRenderer, q: string) => {
  const input = r.root.findAll(n => n.props.keyboardType === 'decimal-pad' && n.props.onChangeText)[0];
  await act(async () => { input.props.onChangeText(q); });
};
const submit = async (r: ReactTestRenderer) => {
  const btn = r.root.findAll(n => typeof n.props.onPress === 'function' && typeof n.props.title === 'string'
    && n.props.title.length > 0 && !n.props.testID)[0];
  await act(async () => { btn.props.onPress(); });
};

beforeEach(() => { mockTransfer.mockClear(); mockRecord.mockClear(); });

test('the owner moves 10 from a van back to the godown', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<StockMoveSheet action="transfer" item={item} vans={vans} onClose={jest.fn()} />));
  });
  // From: the godown and vans holding stock; Sita's empty van isn't a source.
  expect(ids(r, 'move-from-')).toEqual(['move-from-godown', 'move-from-ravi']);
  await press(r, 'move-from-ravi');
  // To: anywhere but Ravi's van.
  expect(ids(r, 'move-to-')).toEqual(['move-to-godown', 'move-to-sita']);
  await press(r, 'move-to-godown');
  await typeQty(r, '10');
  await submit(r);
  expect(mockTransfer).toHaveBeenCalledWith(expect.objectContaining({
    itemId: 'soap', quantity: '10', fromLocation: 'van', fromVanUserId: 'ravi', toLocation: 'godown',
    vanUserId: undefined}), expect.anything());
  act(() => r.unmount());
});

test('staff return stock from their own van to the godown', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<StockMoveSheet action="transfer" item={item} vans={[]} ownVanOnly onClose={jest.fn()} />));
  });
  expect(ids(r, 'move-from-')).toEqual([]);  // the source is their own van, fixed
  expect(ids(r, 'move-to-')).toEqual(['move-to-godown']);
  await press(r, 'move-to-godown');
  await typeQty(r, '3');
  await submit(r);
  expect(mockTransfer).toHaveBeenCalledWith(expect.objectContaining({
    fromLocation: 'van', fromVanUserId: undefined, toLocation: 'godown'}), expect.anything());
  act(() => r.unmount());
});

test('S3: a purchase picks its supplier from the list, or adds a new one', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<StockMoveSheet action="purchase" item={item} vans={[]} onClose={jest.fn()} />));
  });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  const typeIn = async (id: string, v: string) => {
    await act(async () => { r.root.findAll(n => n.props.testID === id && n.props.onChangeText)[0].props.onChangeText(v); });
  };
  await typeIn('purchase-supplier', 'sharma');
  expect(ids(r, 'supplier-')).toEqual(['supplier-sup1']);  // only the matching one
  await press(r, 'supplier-sup1');
  await typeQty(r, '10');
  await typeIn('purchase-price', '80');
  await typeIn('purchase-bill', 'B-1');
  await submit(r);
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'purchase', supplierId: 'sup1', supplier: 'Sharma Traders'}), expect.anything());

  mockRecord.mockClear();
  await typeIn('purchase-supplier', 'Verma Agencies');  // a new name: no id, added by the server
  await submit(r);
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
    supplierId: undefined, supplier: 'Verma Agencies'}), expect.anything());
  act(() => r.unmount());
});

test('S6: a quantity can be entered in another unit of the item', async () => {
  const boxed = {...item, unit: 'pcs', units: [{unit: 'box', factor: '24.000'}]};
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<StockMoveSheet action="sale" item={boxed} vans={[]} onClose={jest.fn()} />));
  });
  expect(ids(r, 'unit-')).toEqual(['unit-pcs', 'unit-box']);
  await press(r, 'unit-box');
  await typeQty(r, '2');
  await submit(r);
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({kind: 'sale', quantity: '2', unit: 'box'}),
    expect.anything());
  mockRecord.mockClear();
  await press(r, 'unit-pcs');  // back to the base unit: no unit sent
  await submit(r);
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({unit: undefined}), expect.anything());
  act(() => r.unmount());
});
