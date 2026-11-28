/**
 * Daily close → Close the day: the beat's figures, counted cash with the
 * difference (counted − expected) as you type, Close (after a confirm), and the
 * closed state with who closed it and when; only the owner can reopen.
 */
import React from 'react';
import {Alert, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {DailyCloseScreen} from './DailyCloseScreen';

jest.setTimeout(60_000);

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

let mockRole: 'owner' | 'staff' = 'staff';
jest.mock('@features/auth/hooks', () => ({
  // Owner: every permission. Staff: add entries only.
  usePermissions: () => ({can: (p: string) => mockRole === 'owner' || p === 'entry.create'}),
}));
let mockClosed: object | null = null;
let mockCounted: string | null = null;
const mockFigures = () => ({
  date: '2026-11-23', beatId: 'b1', collections: [], creditCollected: '1800.50', cashInHand: '1000.00',
  upiClaimed: '500.50', bankClaimed: '300.00', otherClaimed: '0.00', verified: '0.00', creditGiven: '2000.00',
  difference: '1800.50', cashCounted: mockCounted, cashOverShort: null,
  cashCountedAt: mockCounted ? '2026-11-23T19:42:00+05:30' : null, deposits: [], members: [],
  close: mockClosed,
});
jest.mock('@features/reconciliation/presentation/hooks', () => ({
  useDailyClose: () => ({data: mockFigures(), isLoading: false, isError: false, isRefetching: false,
    refetch: jest.fn(async () => undefined)}),
}));
jest.mock('@features/beats/presentation/hooks', () => ({
  useBeats: () => ({data: [{id: 'b1', name: 'North'}], isLoading: false}),
}));
const mockCloseDay = jest.fn(async (..._a: unknown[]) => ({}));
const mockReopen = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('@features/reconciliation/data/reconciliation.remote', () => ({
  reconciliationRemote: {closeDay: (...a: unknown[]) => mockCloseDay(...a), reopenDay: (...a: unknown[]) => mockReopen(...a)},
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' ');
const byId = (r: ReactTestRenderer, id: string) => r.root.findAllByProps({testID: id});
/** Press the confirm dialog's action button (the last one). */
const confirm = async (alert: jest.SpyInstance) => {
  const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as {onPress?: () => void}[];
  await act(async () => { buttons[buttons.length - 1].onPress?.(); });
};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<DailyCloseScreen navigation={{navigate: jest.fn()} as never} route={{params: {beatId: 'b1'}} as never} />);
  });
  return r;
}

test('figures, counted cash with the difference, then Close sends only the count', async () => {
  mockRole = 'staff';
  mockClosed = null;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const r = await render();
  try {
    const text = textOf(r);
    for (const figure of ['1,000.00', '500.50', '2,000.00', '1,800.50']) expect(text).toContain(figure);
    expect(byId(r, 'day-close-difference')).toHaveLength(0);

    await act(async () => byId(r, 'day-close-counted')[0].props.onChangeText('950'));
    expect(textOf(r)).toContain('Difference (counted − expected)');
    expect(textOf(r)).toContain('−₹50.00'); // formatMoney's minus sign

    await act(async () => byId(r, 'day-close-save')[0].props.onPress());
    expect(alert.mock.calls[0][0]).toBe('Close North for the day?');
    await confirm(alert);
    expect(mockCloseDay).toHaveBeenCalledWith('b1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), '950');
    expect(byId(r, 'day-reopen')).toHaveLength(0);
  } finally {
    act(() => r.unmount());
    alert.mockRestore();
  }
});

test('the latest cash count fills in the close; the owner can still change it', async () => {
  mockRole = 'owner';
  mockClosed = null;
  mockCounted = '980.00'; // saved from the Cash counter (or Save count)
  mockCloseDay.mockClear();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const r = await render();
  try {
    expect(byId(r, 'day-close-counted')[0].props.value).toBe('980.00');
    expect(byId(r, 'day-close-from-count')).not.toHaveLength(0);
    expect(textOf(r)).toContain('−₹20.00'); // the difference shows straight away
    await act(async () => byId(r, 'day-close-save')[0].props.onPress());
    await confirm(alert);
    expect(mockCloseDay).toHaveBeenLastCalledWith('b1', expect.any(String), '980.00');

    await act(async () => byId(r, 'day-close-counted')[0].props.onChangeText('1000'));
    expect(byId(r, 'day-close-counted')[0].props.value).toBe('1000');
    expect(byId(r, 'day-close-from-count')).toHaveLength(0); // no longer the count's figure
    await act(async () => byId(r, 'day-close-save')[0].props.onPress());
    await confirm(alert);
    expect(mockCloseDay).toHaveBeenLastCalledWith('b1', expect.any(String), '1000');
  } finally {
    mockCounted = null;
    act(() => r.unmount());
    alert.mockRestore();
  }
});

test('a closed day shows who closed it; only the owner can reopen', async () => {
  mockClosed = {id: 'c1', status: 'closed', cashExpected: '1000.00', cashCounted: '950.00', upiTotal: '500.50',
    creditGiven: '2000.00', creditCollected: '1800.50', difference: '-50.00', closedBy: 'u1',
    closedByName: 'Ravi', closedByMobile: null, closedAt: '2026-11-23T18:10:00+05:30'};
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRole = 'staff';
  let r = await render();
  try {
    expect(textOf(r)).toContain('Closed by Ravi');
    expect(byId(r, 'day-close-counted')).toHaveLength(0); // no closing twice
    expect(byId(r, 'day-reopen')).toHaveLength(0);
  } finally {
    act(() => r.unmount());
  }
  mockRole = 'owner';
  r = await render();
  try {
    await act(async () => byId(r, 'day-reopen')[0].props.onPress());
    await confirm(alert);
    expect(mockReopen).toHaveBeenCalledWith('c1');
  } finally {
    act(() => r.unmount());
    alert.mockRestore();
  }
});
