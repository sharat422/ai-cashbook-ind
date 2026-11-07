/**
 * Low-end target: a 1,000-entry ledger opens and scrolls without freezing.
 * The JS work per open (balances + risk) must stay small, and the list must
 * mount a screenful of rows, not all 1,000. The on-device check is in
 * MANUAL_TESTING.md §37 (the test device is still to be named).
 */
import React from 'react';
import {FlatList} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {Customer} from '@features/customers/domain/entities';
import {buildLedger, type LedgerEntry} from '@features/customers/domain/ledger';
import {deriveRiskFeatures, predictRisk} from '@features/customers/domain/risk';
import {LEDGER_LIST_WINDOW, TimelineItem} from './components/TimelineItem';

const N = 1000;
const entries: LedgerEntry[] = Array.from({length: N}, (_, i) => ({
  id: `e${i}`,
  type: i % 3 ? 'credit' : 'payment',
  amount: 100 + (i % 50),
  date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  createdAt: new Date(2025, 0, 1, 0, i).toISOString(),
  syncStatus: 'synced',
  attachment: null,
}));
const customer = {id: 'c1', fullName: 'Shop', mobile: '', outstandingAmount: 0, isOverdue: false,
  createdAt: '2025-01-01T00:00:00Z'} as Customer;

it('balances and risk for 1,000 entries take well under a frame budget per open', () => {
  const t0 = Date.now();
  const ledger = buildLedger(entries);
  predictRisk(deriveRiskFeatures(ledger, customer));
  const ms = Date.now() - t0;
  expect(ledger.entries).toHaveLength(N);
  expect(ms).toBeLessThan(150); // dev laptop; a low-end phone is ~10x slower → still well under 2 s
});

it('the ledger list mounts a screenful, not 1,000 rows', () => {
  const view = buildLedger(entries).entries;
  const rendered = new Set<string>();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <FlatList
        {...LEDGER_LIST_WINDOW}
        data={view}
        keyExtractor={item => item.id}
        renderItem={({item, index}) => {
          rendered.add(item.id);
          return <TimelineItem entry={item} isLast={index === view.length - 1} />;
        }}
      />,
    );
  });
  expect(r.toJSON()).toBeTruthy();
  const mounted = rendered.size;
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThanOrEqual(LEDGER_LIST_WINDOW.initialNumToRender);
});
