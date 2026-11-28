/**
 * Tapping an income or expense (Recent activity or Transaction history) opens
 * its details: amount, type, category, paid to, date, full notes, sync state
 * and the attached bill photo (a PDF gets "Open file").
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Image, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {EntryDetail} from '@features/transactions/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useAuthStore} from '@store/auth.store';
import {TransactionRow} from '../components/TransactionRow';
import {TransactionDetailScreen} from './TransactionDetailScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
const mockRemove = jest.fn();
const mockRemoveExpense = jest.fn();
jest.mock('@features/income/data/income.remote', () => ({
  incomeRemote: {remove: (...a: unknown[]) => mockRemove(...a)},
}));
jest.mock('@features/expense/data/expense.remote', () => ({
  expenseRemote: {remove: (...a: unknown[]) => mockRemoveExpense(...a)},
}));

const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map(n => [n.props.children].flat().join(''));

const nav = {navigate: jest.fn(), goBack: jest.fn()};

async function show(entry: EntryDetail, role: 'owner' | 'staff' | 'accountant' = 'owner'): Promise<ReactTestRenderer> {
  useAuthStore.setState({business: {role}} as never);
  let r!: ReactTestRenderer;
  await act(async () => {
    const props = {route: {params: {entry}}, navigation: nav} as unknown as React.ComponentProps<typeof TransactionDetailScreen>;
    r = create(<QueryClientProvider client={new QueryClient()}><TransactionDetailScreen {...props} /></QueryClientProvider>);
  });
  return r;
}
const button = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && n.props.onPress)[0];

beforeEach(() => {
  nav.navigate.mockReset();
  nav.goBack.mockReset();
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockRemoveExpense.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => {});
});

const sale: EntryDetail = {id: 'inc1', kind: 'income', amount: 5000, category: 'Sales', date: '2026-11-15', syncStatus: 'synced'};

test('the owner can edit a synced income: the form opens with it', async () => {
  const r = await show(sale);
  await act(async () => button(r, 'tx-edit').props.onPress());
  expect(nav.navigate).toHaveBeenCalledWith('AddIncome', {edit: sale});
  act(() => r.unmount());
});

test('the owner deletes an income after confirming: gone from the phone too, back to the list', async () => {
  useIncomeStore.setState({entries: [{...sale, createdAt: 'x'} as never, {id: 'other', createdAt: 'y'} as never]});
  const r = await show(sale);
  await act(async () => button(r, 'tx-delete').props.onPress());
  const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect([title, message]).toEqual(['Delete this income?', expect.stringContaining('₹5,000 on 15 Nov 2026')]);
  expect(mockRemove).not.toHaveBeenCalled(); // nothing happens until Delete is pressed
  await act(async () => buttons[1].onPress());
  expect(mockRemove).toHaveBeenCalledWith('inc1');
  expect(useIncomeStore.getState().entries.map(e => e.id)).toEqual(['other']);
  expect(nav.goBack).toHaveBeenCalled();
  act(() => r.unmount());
});

test('a failed delete says so and stays on the entry', async () => {
  mockRemove.mockRejectedValueOnce(new Error('No internet connection.'));
  const r = await show(sale);
  await act(async () => button(r, 'tx-delete').props.onPress());
  await act(async () => (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress());
  expect(Alert.alert).toHaveBeenLastCalledWith('Could not delete', 'No internet connection.');
  expect(nav.goBack).not.toHaveBeenCalled();
  act(() => r.unmount());
});

const fuel: EntryDetail = {id: 'exp1', kind: 'expense', amount: 800, category: 'Fuel', date: '2026-11-15',
  vendor: 'Indian Oil', syncStatus: 'synced'};

test('an expense: Edit opens the expense form, Delete asks and removes it', async () => {
  useExpenseStore.setState({entries: [{...fuel, createdAt: 'x'} as never]});
  const r = await show(fuel);
  await act(async () => button(r, 'tx-edit').props.onPress());
  expect(nav.navigate).toHaveBeenCalledWith('AddExpense', {edit: fuel});
  await act(async () => button(r, 'tx-delete').props.onPress());
  const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect([title, message]).toEqual(['Delete this expense?', expect.stringContaining('₹800 on 15 Nov 2026')]);
  await act(async () => buttons[1].onPress());
  expect(mockRemoveExpense).toHaveBeenCalledWith('exp1');
  expect(mockRemove).not.toHaveBeenCalled();
  expect(useExpenseStore.getState().entries).toEqual([]);
  expect(nav.goBack).toHaveBeenCalled();
  act(() => r.unmount());
});

test("a stock purchase's expense: no Edit or Delete, it says to reverse the purchase in Stock", async () => {
  const r = await show({...fuel, category: 'Purchases', purchase: true});
  expect(button(r, 'tx-edit')).toBeUndefined();
  expect(button(r, 'tx-delete')).toBeUndefined();
  expect(texts(r)).toContain('This is a stock purchase. To cancel it, reverse the purchase in Stock: its expense goes with it.');
  act(() => r.unmount());
});

test.each([
  ['staff', sale],
  ['accountant', sale],
  ['staff', fuel],
  ['owner', {...sale, syncStatus: 'pending' as const}], // not on the server yet: Sync status discards it
  ['owner', {...fuel, syncStatus: 'pending' as const}],
] as const)('no Edit or Delete for %s on %j', async (role, entry) => {
  const r = await show(entry, role);
  expect(button(r, 'tx-edit')).toBeUndefined();
  expect(button(r, 'tx-delete')).toBeUndefined();
  act(() => r.unmount());
});

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
