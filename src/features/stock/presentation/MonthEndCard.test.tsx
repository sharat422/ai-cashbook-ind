/** S8: the home card shows only while the month-end count is due (last 3
 *  days, month not yet confirmed), and opens the count screen. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {MonthEndCard} from './MonthEndCard';

let mockDue = true;
jest.mock('@features/stock/data/stock.remote', () => ({
  stockRemote: {monthStatus: async () => ({month: '2026-11', counted: false, locked: !mockDue, reminderDue: mockDue,
    lockedAt: null, lockedBy: null, unlockedAt: null, unlockedBy: null})},
}));

async function render(onPress = jest.fn()): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <MonthEndCard onPress={onPress} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  return r;
}

test('shows while the count is due and opens the count screen', async () => {
  mockDue = true;
  const onPress = jest.fn();
  const r = await render(onPress);
  const card = r.root.findAll(n => n.props.testID === 'month-end-card' && n.props.onPress);
  expect(card.length).toBeGreaterThan(0);  // the Pressable and its host view
  await act(async () => { card[0].props.onPress(); });
  expect(onPress).toHaveBeenCalled();
  act(() => r.unmount());
});

test('is gone once the month is counted and locked', async () => {
  mockDue = false;
  const r = await render();
  expect(r.root.findAll(n => n.props.testID === 'month-end-card')).toHaveLength(0);
  act(() => r.unmount());
});
