/**
 * Payments against bills. The payment sheet lists the open bills oldest first
 * and puts the payment on them in order (FIFO), showing the split; a bill can
 * be left out; the bills picked go with the payment. The ledger says which
 * bills a payment paid, or "Not linked to a bill". The statement lists each
 * bill with its amount, paid, left and Paid / Partly paid / Open.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {AmountInput} from '@components/form';
import {Button} from '@components/ui';
import {splitPayment, type Bill, type CustomerBills} from '@features/customers/domain/bills';
import type {LedgerEntryView} from '@features/customers/domain/ledger';
import {ReceivePaymentSheet, type ReceivePaymentInput} from './ReceivePaymentSheet';
import {StatementBillsCard} from './StatementBillsCard';
import {TransactionCard} from './TransactionCard';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/beats/presentation/components/BeatPicker', () => ({BeatPicker: () => null}));

const bill = (id: string, date: string, amount: number, paid: number, number?: string): Bill => ({
  id, date, number, amount, paid, left: amount - paid, status: paid >= amount ? 'paid' : paid > 0 ? 'part' : 'open',
});
const BILLS: CustomerBills = {
  bills: [
    bill('old-paid', '2026-08-01', 1000, 1000, 'INV-0'),
    bill('a', '2026-10-01', 5000, 0, 'INV-1'),
    bill('b', '2026-11-01', 4000, 1000),
  ],
  left: 8000, advance: 0, unlinked: 0,
};
const mockList = jest.fn(async (_id: string, _beat?: string) => BILLS);
jest.mock('@features/customers/data/bills.remote', () => ({
  billsRemote: {list: (id: string, beat?: string) => mockList(id, beat)},
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join(' | ');
const wrap = (el: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>;
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
};
const gets = (r: ReactTestRenderer, id: string) =>
  r.root.findAllByProps({testID: `pay-bill-gets-${id}`}).map(n => n.props.children)[0];

async function openSheet(onSubmit: (i: ReceivePaymentInput) => void, amount: number) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<ReceivePaymentSheet visible outstanding={8000} onClose={() => {}} onSubmit={onSubmit}
      customerId="c1" />));
  });
  await settle();
  await act(async () => r.root.findByType(AmountInput).props.onChange(amount));
  await act(async () => r.root.findAll(n => n.props.label === 'Cash' && typeof n.props.onPress === 'function')[0].props.onPress());
  return r;
}
const submit = async (r: ReactTestRenderer) =>
  act(async () => r.root.findAllByType(Button).find(b => String(b.props.title).startsWith('Receive'))!.props.onPress());

test('the payment goes on the oldest open bills first, and the split is shown and sent', async () => {
  const onSubmit = jest.fn();
  const r = await openSheet(onSubmit, 7000);
  expect(r.root.findAllByProps({testID: 'pay-bill-old-paid'})).toHaveLength(0); // paid bills aren't offered
  expect(gets(r, 'a')).toBe('₹5,000');
  expect(gets(r, 'b')).toBe('₹2,000');
  expect(textOf(r)).toContain('₹3,000 left of ₹4,000');
  await submit(r);
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    amount: 7000, allocations: [{billId: 'a', amount: 5000}, {billId: 'b', amount: 2000}]}));
  act(() => r.unmount());
});

test('a bill left out takes nothing; what no bill takes is not linked to a bill', async () => {
  const onSubmit = jest.fn();
  const r = await openSheet(onSubmit, 7000);
  await act(async () => r.root.findAllByProps({testID: 'pay-bill-a'})[0].props.onPress());
  expect(gets(r, 'a')).toBeUndefined();
  expect(gets(r, 'b')).toBe('₹3,000');
  expect(textOf(r)).toContain('₹4,000 is more than the bills picked: not linked to a bill.');
  await submit(r);
  expect(onSubmit.mock.calls[0][0].allocations).toEqual([{billId: 'b', amount: 3000}]);
  act(() => r.unmount());
});

test('a part-payment goes on the oldest bill only', async () => {
  const onSubmit = jest.fn();
  const r = await openSheet(onSubmit, 2000);
  expect(gets(r, 'a')).toBe('₹2,000');
  expect(gets(r, 'b')).toBeUndefined();
  await submit(r);
  expect(onSubmit.mock.calls[0][0].allocations).toEqual([{billId: 'a', amount: 2000}]);
  act(() => r.unmount());
});

test('the split is exact in paise', () => {
  const bills = [bill('x', '2026-01-01', 50.1, 0), bill('y', '2026-01-02', 50.2, 0)];
  expect(splitPayment(bills, 100.3)).toEqual({split: [{billId: 'x', amount: 50.1}, {billId: 'y', amount: 50.2}], extra: 0});
  expect(splitPayment(bills, 120, new Set(['x']))).toEqual({split: [{billId: 'y', amount: 50.2}], extra: 69.8});
});

test('the ledger says which bills a payment paid, or that it is not linked to a bill', () => {
  const entry = (bills?: LedgerEntryView['bills']): LedgerEntryView => ({
    id: 'p', type: 'payment', amount: 6000, date: '2026-11-20', createdAt: '', balance: 0, bills});
  const linked = create(<TransactionCard entry={entry([{billId: 'a', number: 'INV-1', date: '2026-11-03', amount: 6000}])} />);
  expect(textOf(linked)).toContain('For INV-1 · 03 Nov 2026 (₹6,000)');
  const old = create(<TransactionCard entry={entry([])} />);
  expect(textOf(old)).toContain('Not linked to a bill');
  const unknown = create(<TransactionCard entry={entry(undefined)} />); // e.g. still waiting to sync
  expect(unknown.root.findAllByProps({testID: 'paid-bills-p'})).toHaveLength(0);
});

test('the statement shows every open bill and the bills in its dates, bill by bill', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<StatementBillsCard customerId="c1" from="2026-11-01" to="2026-11-30" />));
  });
  await settle();
  const text = textOf(r);
  expect(r.root.findAllByProps({testID: 'statement-bill-old-paid'})).toHaveLength(0); // paid, before these dates
  expect(text).toContain('INV-1 · 01 Oct 2026');
  expect(text).toContain('Bill ₹5,000 · Paid ₹0 · Left ₹5,000');
  expect(text).toContain('Open');
  expect(text).toContain('Sale of 01 Nov 2026');
  expect(text).toContain('Bill ₹4,000 · Paid ₹1,000 · Left ₹3,000');
  expect(text).toContain('Partly paid');
  expect(text).toContain('Left on open bills: ₹8,000');
  act(() => r.unmount());
});
