/**
 * S4 on the phone: stock history offers Reverse on an entry (after a
 * confirmation), marks a reversed one, and never offers it on a count, a
 * reversal row or something already reversed.
 */
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {StockHistoryScreen} from './StockHistoryScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => true})}));

const move = (id: string, kind: string, quantity: string, extra = {}) => ({
  id, itemId: 'soap', location: 'godown', vanUserId: null, kind, quantity, date: '2026-11-11', groupId: null,
  counted: kind === 'count' ? '4.000' : null, note: null, supplier: null, unitPrice: null, billRef: null,
  reversesId: null, reversed: false, ...extra,
});
const mockReverse = jest.fn();
jest.mock('@features/stock/presentation/hooks', () => ({
  useStockMoves: () => ({isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(), data: [
    move('buy', 'purchase', '10.000'),
    move('old', 'purchase', '5.000', {reversed: true}),
    move('mirror', 'purchase', '-5.000', {reversesId: 'old'}),
    move('cnt', 'count', '-1.000'),
  ]}),
  useStockLevels: () => ({data: {items: [], vans: []}}),
  useStockMutations: () => ({reverse: {mutate: mockReverse, isPending: false}}),
}));

const has = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id).length > 0;

test('only a live, non-count entry can be reversed, after confirming', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<StockHistoryScreen navigation={{} as any} route={{params: {itemId: 'soap', name: 'Soap'}} as any} />);
  });
  try {
    expect(has(r, 'reverse-buy')).toBe(true);
    expect(has(r, 'reverse-old') || has(r, 'reverse-mirror') || has(r, 'reverse-cnt')).toBe(false);
    expect(has(r, 'reversed-old')).toBe(true);
    await act(async () => { r.root.findAll(n => n.props.testID === 'reverse-buy' && n.props.onPress)[0].props.onPress(); });
    expect(mockReverse).not.toHaveBeenCalled(); // asks first
    const [, , buttons] = alert.mock.calls[0];
    await act(async () => { buttons!.find(b => b.style === 'destructive')!.onPress!(); });
    expect(mockReverse).toHaveBeenCalledWith('buy', expect.anything());
  } finally {
    act(() => r.unmount());
  }
});
