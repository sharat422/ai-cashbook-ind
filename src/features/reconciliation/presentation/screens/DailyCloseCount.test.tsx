/**
 * Daily close → counted cash per salesperson: each row is pre-filled with
 * that person's cash and shows their over/short; staff get only their own row.
 */
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useAuthStore} from '@store/auth.store';
import {DailyCloseScreen} from './DailyCloseScreen';

jest.setTimeout(60_000);

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

let mockOwner = true;
jest.mock('@features/auth/hooks', () => ({
  usePermissions: () => ({can: () => mockOwner}),
}));
const member = (userId: string, name: string, cash: string, counted: string | null, overShort: string | null) => ({
  userId, name, mobile: null, collected: cash, cash, creditGiven: '0.00', cashCounted: counted, cashOverShort: overShort,
});
const mockClose = () => ({
  date: '2026-11-09', beatId: 'b1', collections: [], creditCollected: '13000.00', cashInHand: '13000.00',
  upiClaimed: '0.00', bankClaimed: '0.00', otherClaimed: '0.00', verified: '0.00', creditGiven: '0.00',
  difference: '13000.00', cashCounted: mockOwner ? '7900.00' : null, cashOverShort: null, cashCountedAt: null,
  cashCountByPerson: true, deposits: [],
  members: [member('ravi', 'Ravi', '8000.00', '7900.00', '-100.00'), member('priya', 'Priya', '5000.00', null, null)],
});
jest.mock('@features/reconciliation/presentation/hooks', () => ({
  useDailyClose: () => ({data: mockClose(), isLoading: false, isError: false, isRefetching: false, refetch: jest.fn()}),
}));
jest.mock('@features/beats/presentation/hooks', () => ({
  useBeats: () => ({data: [{id: 'b1', name: 'Ring Road'}], isLoading: false}),
}));
const mockCount = jest.fn(async (..._a: unknown[]) => ({}));
const mockDeposit = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('@features/reconciliation/data/reconciliation.remote', () => ({
  reconciliationRemote: {cashCount: (...a: unknown[]) => mockCount(...a), recordDeposit: (...a: unknown[]) => mockDeposit(...a)},
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' ');
const byId = (r: ReactTestRenderer, id: string) => r.root.findAllByProps({testID: id});

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<DailyCloseScreen navigation={{navigate: jest.fn()} as any} route={{params: {beatId: 'b1'}} as any} />);
  });
  return r;
}

test('the owner sees a row per salesperson, pre-filled, with the short against Ravi', async () => {
  mockOwner = true;
  const r = await render();
  try {
    expect(byId(r, 'count-person-ravi').length).toBeGreaterThan(0);
    expect(byId(r, 'count-person-input-priya')[0].props.value).toBe('5000.00'); // pre-filled with Priya's cash
    expect(textOf(r)).toContain('Short by');
    expect(textOf(r)).toContain('once everyone holding cash is counted'); // Priya not counted yet
    await act(async () => { byId(r, 'count-person-save-priya')[0].props.onPress(); });
    expect(mockCount).toHaveBeenCalledWith(expect.any(String), 'b1', '5000.00', 'priya');
    // Deposits: a row per salesperson, pre-filled with their counted cash (else their cash recorded).
    expect(byId(r, 'deposit-person-input-ravi')[0].props.value).toBe('7900.00');
    await act(async () => { byId(r, 'deposit-person-save-ravi')[0].props.onPress(); });
    expect(mockDeposit).toHaveBeenCalledWith(expect.any(String), 'b1', '7900.00', 'deposit', 'ravi');
  } finally {
    act(() => r.unmount());
  }
});

test('staff see and count only their own cash', async () => {
  mockOwner = false; // staff: no DATA_VIEW
  useAuthStore.setState({user: {id: 'priya', mobile: '9000000002'}});
  const r = await render();
  try {
    expect(byId(r, 'count-person-priya').length).toBeGreaterThan(0);
    expect(byId(r, 'count-person-ravi')).toHaveLength(0);
    expect(byId(r, 'deposit-person-priya')).toHaveLength(0); // only the owner records deposits
  } finally {
    act(() => r.unmount());
    useAuthStore.setState({user: null});
  }
});
