/**
 * Match by hand, split direction: tick two bank lines for one ₹1,000
 * collection. The counter reads "Picked ₹X of ₹1,000.00" and Match stays off
 * until the lines cover it exactly (the server checks again). And a cash
 * deposit: only a bank line of the same amount can be picked.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {BankLine, Collection} from '@features/reconciliation/data/reconciliation.remote';
import {BankMatchScreen} from './BankMatchScreen';

jest.setTimeout(90_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));

const line = (id: string, amount: string): BankLine =>
  ({id, date: '2026-11-08', amount, remaining: amount, utr: null, narration: null}) as BankLine;
const mockSplit = jest.fn(async () => ({}));
const mockMatchDeposit = jest.fn(async () => ({}));
jest.mock('@features/reconciliation/data/reconciliation.remote', () => ({
  reconciliationRemote: {
    lineCandidates: async () => [line('l600', '600.00'), line('l500', '500.00'), line('l400', '400.00')],
    split: (...a: unknown[]) => mockSplit(...(a as [])),
    depositLines: async () => [line('l5000', '5000.00'), line('l4500', '4500.00')],
    matchDeposit: (...a: unknown[]) => mockMatchDeposit(...(a as [])),
  },
}));

const collection = {id: 'e1', customerId: 'c', customerName: 'Ravi', date: '2026-11-08', amount: '1000.00',
  mode: 'upi', reference: null} as unknown as Collection;
const text = (r: ReactTestRenderer, id: string) =>
  ([] as unknown[]).concat(r.root.findAll(n => n.props.testID === id && n.type === Text)[0].props.children).join('');
const matchOn = (r: ReactTestRenderer) =>
  !r.root.findAll(n => n.props.testID === 'split-confirm' && 'disabled' in n.props)[0].props.disabled;
const tap = async (r: ReactTestRenderer, id: string) => {
  await act(async () => { r.root.findAll(n => n.props.testID === id && n.props.onPress)[0].props.onPress(); });
};

test('Match is enabled only when the ticked lines cover the collection exactly', async () => {
  const goBack = jest.fn();
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      r = create(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <BankMatchScreen navigation={{goBack} as any} route={{params: {collection}} as any} />
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise(res => setTimeout(res, 0)); });
    await tap(r, 'line-l600');
    await tap(r, 'line-l500');
    expect(text(r, 'split-total')).toContain('1,100.00');
    expect(matchOn(r)).toBe(false); // over
    await tap(r, 'line-l500');
    expect(matchOn(r)).toBe(false); // under: one line of 600
    await tap(r, 'line-l400');
    expect(text(r, 'split-total')).toMatch(/1,000\.00.*1,000\.00/);
    expect(matchOn(r)).toBe(true);
    await tap(r, 'split-confirm');
    expect(mockSplit).toHaveBeenCalledWith(['l600', 'l400'], 'e1');
    expect(goBack).toHaveBeenCalled();
  } finally {
    act(() => r?.unmount());
  }
});

test('a cash deposit matches only a bank line of the same amount, after a confirm', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const goBack = jest.fn();
  const deposit = {id: 'd1', beatId: null, date: '2026-11-08', kind: 'deposit', amount: '5000.00', note: null,
    bankLineId: null, matched: false};
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      r = create(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <BankMatchScreen navigation={{goBack} as any} route={{params: {deposit}} as any} />
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise(res => setTimeout(res, 0)); });
    const row = (id: string) => r.root.findAll(n => n.props.testID === id && 'disabled' in n.props)[0];
    expect(row('dep-line-l4500').props.disabled).toBe(true);
    expect(row('dep-line-l5000').props.disabled).toBe(false);
    await tap(r, 'dep-line-l5000');
    expect(mockMatchDeposit).not.toHaveBeenCalled(); // asks first
    const [, , buttons] = alert.mock.calls[0];
    await act(async () => { buttons!.find(b => b.style !== 'cancel')!.onPress!(); });
    expect(mockMatchDeposit).toHaveBeenCalledWith('d1', 'l5000');
    expect(goBack).toHaveBeenCalled();
  } finally {
    act(() => r?.unmount());
  }
});
