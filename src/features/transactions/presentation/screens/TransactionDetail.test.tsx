/**
 * Tapping an income or expense (Recent activity or Transaction history) opens
 * its details: amount, type, category, paid to, date, full notes, sync state
 * and the attached bill photo (a PDF gets "Open file").
 */
import React from 'react';
import {Image, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {EntryDetail} from '@features/transactions/domain/entities';
import {TransactionRow} from '../components/TransactionRow';
import {TransactionDetailScreen} from './TransactionDetailScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));

const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map(n => [n.props.children].flat().join(''));

async function show(entry: EntryDetail): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    const props = {route: {params: {entry}}, navigation: {}} as unknown as React.ComponentProps<typeof TransactionDetailScreen>;
    r = create(<TransactionDetailScreen {...props} />);
  });
  return r;
}

test('an expense: every saved field, the full notes and the bill photo', async () => {
  const r = await show({kind: 'expense', amount: 800, category: 'Fuel', date: '2026-11-15', vendor: 'Indian Oil',
    notes: 'Diesel for the van\nBill 4512', attachmentUrl: 'https://api.example.com/uploads/abc.jpg', syncStatus: 'pending'});
  const shown = texts(r);
  expect(shown).toEqual(expect.arrayContaining(['Entry details', '−₹800', 'Expense', 'Fuel', 'Indian Oil',
    'Diesel for the van\nBill 4512', 'Waiting to sync']));
  expect(r.root.findByType(Image).props.source).toEqual({uri: 'https://api.example.com/uploads/abc.jpg'});
  act(() => r.unmount());
});

test('an income with a PDF and no notes: "Open file", no paid-to row', async () => {
  const r = await show({kind: 'income', amount: 5000, category: 'Sales', date: '2026-11-15',
    attachmentUrl: 'https://api.example.com/uploads/bill.pdf', syncStatus: 'synced'});
  const shown = texts(r);
  expect(shown).toEqual(expect.arrayContaining(['+₹5,000', 'Income', 'Open file']));
  expect(shown).not.toContain('Vendor / Paid to');
  expect(r.root.findAllByType(Image)).toHaveLength(0);
  act(() => r.unmount());
});

test('tapping a history row opens that entry', async () => {
  const onPress = jest.fn();
  const tx = {id: 't1', type: 'expense' as const, amount: 120, category: 'Fuel', date: '2026-11-15', createdAt: 'x'};
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<TransactionRow tx={tx} onPress={onPress} />); });
  await act(async () => { r.root.findByProps({testID: 'tx-row-t1'}).props.onPress(); });
  expect(onPress).toHaveBeenCalledWith(tx);
  act(() => r.unmount());
});
