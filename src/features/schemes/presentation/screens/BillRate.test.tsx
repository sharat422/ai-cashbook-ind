/** BL8 on the phone: the owner can change a line's rate on the bill. The new
 *  rate goes to the preview (line, bill total and schemes re-worked) and to
 *  the save, marked "rate changed"; an untouched rate is sent as nothing. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {BillScreen} from './BillScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => true})}));
jest.mock('@/shared/hooks/useDebouncedValue', () => ({useDebouncedValue: <T,>(v: T) => v}));
jest.mock('@components/form', () => ({
  ...jest.requireActual('@components/form'),
  DateField: () => null,
}));
jest.mock('@features/items/data/item.remote', () => ({
  itemRemote: {list: async () => ({items: [{id: 'ghee', name: 'Ghee', type: 'product', unit: 'pcs', salePrice: 120}],
    nextCursor: null, total: 1})},
}));
jest.mock('@features/stock/presentation/hooks', () => ({
  STOCK_KEY: 'stock',
  useStockLevels: () => ({data: {items: [], vans: []}}),
  useVanStock: () => ({data: []}),
}));
type Line = {itemId: string; quantity: string; rate?: string};
const mockPreview = jest.fn(async (input: {lines: Line[]}) => {
  const lines = input.lines.map(l => {
    const rate = Number(l.rate ?? 120);
    return {itemId: l.itemId, name: 'Ghee', unit: 'pcs', quantity: l.quantity, rate: rate.toFixed(2),
      rateChanged: rate !== 120, amount: (rate * Number(l.quantity)).toFixed(2), scheme: null, notApplied: []};
  });
  const total = lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2);
  return {lines, subtotal: total, discount: '0.00', total};
});
const mockCreate = jest.fn(async (..._a: unknown[]) => ({id: 'b1', billNumber: 'B-1', total: '0.00'}));
jest.mock('@features/schemes/data/schemes.remote', () => ({
  schemesRemote: {
    preview: (i: {lines: Line[]}) => mockPreview(i),
    createBill: (...a: unknown[]) => mockCreate(...a),
  },
}));

const settle = () => act(async () => { await new Promise(res => setTimeout(res, 0)); });
const byId = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id);
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

async function billOneGhee(rate?: string): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <BillScreen navigation={{goBack: jest.fn()} as any}
          route={{params: {customer: {id: 'c1', fullName: 'Ravi Stores'}}} as any} />
      </QueryClientProvider>,
    );
  });
  await settle();
  const press = (tid: string) => r.root.findAll(n => n.props.testID === tid && typeof n.props.onPress === 'function')[0].props.onPress();
  await act(async () => { press('bill-item-picker'); });
  await settle();
  await act(async () => { press('bill-item-picker-item-ghee'); });
  await act(async () => {
    byId(r, 'bill-line-ghee')[0].findAll(n => n.props.placeholder && n.props.onChangeText)[0].props.onChangeText('2');
  });
  expect(byId(r, 'bill-rate-ghee').find(n => 'value' in n.props)!.props.value).toBe('120');  // pre-filled
  if (rate !== undefined) {
    await act(async () => { byId(r, 'bill-rate-ghee').find(n => n.props.onChangeText)!.props.onChangeText(rate); });
  }
  await settle();
  return r;
}

const save = async (r: ReactTestRenderer) => {
  await act(async () => { r.root.findAll(n => n.props.title === 'Save bill' && n.props.onPress)[0].props.onPress(); });
};

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockPreview.mockClear();
  mockCreate.mockClear();
});

test('changing a rate from ₹120 to ₹110 re-works the line and bill total, and saves it marked', async () => {
  const r = await billOneGhee('110');
  expect(mockPreview).toHaveBeenLastCalledWith(expect.objectContaining({lines: [{itemId: 'ghee', quantity: '2', rate: '110'}]}));
  expect(text(r)).toContain('220.00');  // 2 × ₹110, before saving
  expect(byId(r, 'rate-changed-ghee').length).toBeGreaterThan(0);
  await save(r);
  expect(mockCreate.mock.calls[0][0]).toMatchObject({lines: [{itemId: 'ghee', quantity: '2', rate: '110'}]});
  act(() => r.unmount());
});

test('an untouched rate sends no rate (the catalogue price) and shows no mark', async () => {
  const r = await billOneGhee();
  expect(text(r)).toContain('240.00');
  expect(byId(r, 'rate-changed-ghee')).toEqual([]);
  await save(r);
  expect(mockCreate.mock.calls[0][0]).toMatchObject({lines: [{itemId: 'ghee', quantity: '2'}]});
  expect((mockCreate.mock.calls[0][0] as {lines: Line[]}).lines[0]).not.toHaveProperty('rate');
  act(() => r.unmount());
});
