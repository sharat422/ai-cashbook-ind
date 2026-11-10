/**
 * Match by hand, several transfers for several bills: from the ₹900 line, add
 * the ₹600 line and tick three ₹500 collections. Two counters show both
 * sides; Match stays off until both are covered exactly and equal.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
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
const bill = (id: string, amount: string) =>
  ({id, customerId: 'c', customerName: 'Ravi', date: '2026-11-08', amount, mode: 'upi', reference: null}) as unknown as Collection;
const mockMatchMany = jest.fn(async () => ({}));
jest.mock('@features/reconciliation/data/reconciliation.remote', () => ({
  reconciliationRemote: {
    candidates: async () => [bill('e1', '500.00'), bill('e2', '500.00'), bill('e3', '500.00'), bill('e4', '400.00')],
    otherLines: async () => [line('l600', '600.00')],
    matchMany: (...a: unknown[]) => mockMatchMany(...(a as [])),
  },
}));

const text = (r: ReactTestRenderer, id: string) =>
  ([] as unknown[]).concat(r.root.findAll(n => n.props.testID === id && n.type === Text)[0].props.children).join('');
const matchOn = (r: ReactTestRenderer) =>
  !r.root.findAll(n => n.props.testID === 'match-confirm' && 'disabled' in n.props)[0].props.disabled;
const tap = async (r: ReactTestRenderer, id: string) => {
  await act(async () => { r.root.findAll(n => n.props.testID === id && n.props.onPress)[0].props.onPress(); });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
};

test('two lines and three collections: Match only when both sides are covered exactly', async () => {
  const goBack = jest.fn();
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      r = create(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <BankMatchScreen navigation={{goBack} as any} route={{params: {line: line('l900', '900.00')}} as any} />
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise(res => setTimeout(res, 0)); });
    await tap(r, 'more-lines');
    await tap(r, 'more-line-l600');
    await tap(r, 'cand-e1');
    await tap(r, 'cand-e2');
    expect(text(r, 'match-total-bank')).toContain('1,000.00');
    expect(text(r, 'match-total-bank')).toContain('1,500.00');
    expect(matchOn(r)).toBe(false); // ₹1,000 of ₹1,500: a line would be left part-matched
    await tap(r, 'cand-e4');
    expect(matchOn(r)).toBe(false); // ₹1,400 of ₹1,500
    await tap(r, 'cand-e4');
    await tap(r, 'cand-e3');
    expect(text(r, 'match-total-collections')).toContain('1,500.00');
    expect(matchOn(r)).toBe(true);
    await tap(r, 'match-confirm');
    expect(mockMatchMany).toHaveBeenCalledWith(['l900', 'l600'], ['e1', 'e2', 'e3']);
  } finally {
    act(() => r?.unmount());
  }
});
