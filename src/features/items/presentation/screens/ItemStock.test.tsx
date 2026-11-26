/**
 * Settings → Item catalog → an item → its stock: the quantity now, stock in
 * (purchase) and stock out (sale) through the same sheet as the Stock screen,
 * and the item's latest movements (date, kind, bill, ± quantity).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {Item} from '@features/items/domain/entities';
import {ItemFormScreen} from './ItemFormScreen';
import {ItemListScreen} from './ItemListScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({role: 'owner', can: () => true})}));

const soap: Item = {
  id: 'soap', name: 'Soap', type: 'product', salePrice: 25, purchasePrice: 20, unit: 'box', hsnSac: '3401',
  gstRate: 18, trackStock: true, stockQty: 7, lowStockThreshold: null, createdAt: '2026-11-01T00:00:00Z',
};
jest.mock('@features/items/data/item.remote', () => ({
  itemRemote: {list: async () => ({items: [soap], nextCursor: null, total: 1})},
}));
const move = (id: string, kind: string, quantity: string, billRef: string | null) => ({
  id, itemId: 'soap', location: 'godown', vanUserId: null, kind, quantity, counted: null, date: '2026-11-25',
  note: null, supplier: null, supplierId: null, billRef, enteredUnit: null, enteredQty: null, reversesId: null,
  reversed: false, createdBy: 'u1', createdAt: '2026-11-25T10:00:00Z',
});
jest.mock('@features/stock/data/stock.remote', () => ({
  stockRemote: {
    levels: async () => ({items: [{id: 'soap', name: 'Soap', unit: 'box', purchasePrice: 20, salePrice: 25,
      lowStockThreshold: null, godown: '7.000', vans: {}, total: '7.000', low: false}], vans: []}),
    moves: async () => [move('m2', 'sale', '-3.000', null), move('m1', 'purchase', '10.000', 'HD/101')],
    suppliers: async () => [],
  },
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c !== 'object').join('')).join(' | ');
const pressable = (r: ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0];
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
};
const wrap = (el: React.ReactElement) =>
  <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>;

test('the item catalog opens the item, which shows its stock, history and stock in / out', async () => {
  const navigate = jest.fn();
  let list!: ReactTestRenderer;
  await act(async () => { list = create(wrap(<ItemListScreen navigation={{navigate} as never} route={{} as never} />)); });
  await settle();
  const row = list.root.findAll(n => typeof n.props.onPress === 'function' && textOf({root: n} as never).includes('Soap'))[0];
  await act(async () => row.props.onPress());
  expect(navigate).toHaveBeenCalledWith('ItemForm', {item: soap});
  act(() => list.unmount());

  let detail!: ReactTestRenderer;
  await act(async () => {
    detail = create(wrap(<ItemFormScreen navigation={{navigate, goBack: jest.fn()} as never}
      route={{params: {item: soap}} as never} />));
  });
  await settle();
  const text = textOf(detail);
  expect(text).toContain('Total 7 box');
  expect(text).toContain('Purchase · Bill HD/101');
  expect(text).toContain('+10');
  expect(text).toContain('−3'); // formatQty's minus sign
  expect(detail.root.findAllByProps({testID: 'item-stock-move'}).length).toBeGreaterThan(0);

  // Stock in opens the purchase form (supplier, price, bill); stock out the sale form.
  await act(async () => pressable(detail, 'item-stock-in').props.onPress());
  expect(detail.root.findAllByProps({testID: 'purchase-bill'}).length).toBeGreaterThan(0);
  await act(async () => pressable(detail, 'item-stock-history').props.onPress());
  expect(navigate).toHaveBeenCalledWith('StockHistory', {itemId: 'soap', name: 'Soap'});
  act(() => detail.unmount());
});
