/**
 * One ledger per beat. The beat list comes from the server (staff get only
 * their own); the screen shows that beat's entries with name, amount, date,
 * invoice number and payment method. Credit and payments can be put on a beat:
 * staff start on their beat, owners on none.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {Beat} from '@features/beats/data/beats.remote';
import {useAuthStore} from '@store/auth.store';
import {BeatPicker} from '../components/BeatPicker';
import {BeatLedgerScreen} from './BeatLedgerScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));

const beat = (id: string, name: string, customerIds: string[] = []): Beat => ({
  id, name, version: 1, weekdays: [0], assignedUserId: null, assignments: [],
  retailers: customerIds.map((customerId, i) => ({customerId, fullName: customerId, businessName: null, visitOrder: i,
    outstandingAmount: 0, overdueAmount: 0, creditLimit: null, lastPromiseDate: null, todayVisit: null})),
});
const mockList = jest.fn<Promise<Beat[]>, []>();
const mockLedger = jest.fn(async (beatId: string) => beatId === 'north' ? [
  {id: 'e1', customerName: 'Gupta Stores', type: 'payment', amount: 1500, date: '2026-11-20',
    invoiceNumber: null, paymentMethod: 'cash'},
  {id: 'e2', customerName: 'Rao Kirana', type: 'credit', amount: 900, date: '2026-11-19',
    invoiceNumber: 'INV-7', paymentMethod: null},
] : []);
jest.mock('@features/beats/data/beats.remote', () => ({
  beatsRemote: {list: () => mockList(), ledger: (id: string) => mockLedger(id)},
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join(' | ');
const asRole = (role: 'owner' | 'staff') => useAuthStore.setState({business: {role}} as never);
const wrap = (el: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>;
// React Query tells components on a timer: let it run inside act, before the test ends.
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
};

beforeEach(() => mockLedger.mockClear());

test('owner: every beat, and each beat shows only its own entries', async () => {
  asRole('owner');
  mockList.mockResolvedValue([beat('north', 'North'), beat('south', 'South')]);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<BeatLedgerScreen navigation={{} as never} route={{params: undefined} as never} />));
  });
  await settle();
  expect(r.root.findAllByProps({testID: 'beat-south'}).length).toBeGreaterThan(0);
  expect(mockLedger).toHaveBeenLastCalledWith('north');
  expect(r.root.findAllByProps({testID: 'beat-ledger-row'}).length).toBeGreaterThan(0);
  const text = textOf(r);
  expect(text).toContain('Gupta Stores');
  expect(text).toContain('Invoice INV-7');
  expect(text).toContain('Cash');
  expect(text).toContain('₹1,500');

  await act(async () => r.root.findAllByProps({testID: 'beat-south'})[0].props.onPress());
  await settle();
  expect(mockLedger).toHaveBeenLastCalledWith('south');
  expect(textOf(r)).toContain('No entries on this beat yet');
  act(() => r.unmount());
});

test('staff: only their own beat is shown and asked for', async () => {
  asRole('staff');
  mockList.mockResolvedValue([beat('north', 'North')]); // the server's answer for this staff member
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<BeatLedgerScreen navigation={{} as never} route={{params: undefined} as never} />));
  });
  await settle();
  expect(r.root.findAllByProps({testID: 'beat-north'}).length).toBeGreaterThan(0);
  expect(r.root.findAllByProps({testID: 'beat-south'})).toHaveLength(0);
  expect(mockLedger.mock.calls.map(c => c[0])).toEqual(['north']);
  act(() => r.unmount());
});

test.each([
  ['staff', 'north'],
  ['owner', undefined],
] as const)('beat picker: %s starts on %s', async (role, expected) => {
  asRole(role);
  mockList.mockResolvedValue([beat('north', 'North', ['c1']), beat('south', 'South', ['c2'])]);
  const onChange = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<BeatPicker customerId="c1" value={undefined} onChange={onChange} />));
  });
  await settle();
  // Only the customer's beats are offered.
  expect(r.root.findAllByProps({testID: 'beat-pick-north'}).length).toBeGreaterThan(0);
  expect(r.root.findAllByProps({testID: 'beat-pick-south'})).toHaveLength(0);
  expect(onChange.mock.calls).toEqual(expected ? [[expected]] : []);
  act(() => r.unmount());
});
