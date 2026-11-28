/**
 * Promise to pay: the visit sheet takes an amount with the date; "Promises due
 * today" (day list and home screen) lists open ones dated today or earlier,
 * overdue ones flagged; tapping one opens Receive payment with what's left of it.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {AmountInput} from '@components/form';
import type {BeatRetailer, PromiseDue} from '@features/beats/data/beats.remote';
import {BeatDayListScreen} from '@features/beats/presentation/screens/BeatDayListScreen';
import {useAuthStore} from '@store/auth.store';
import {todayIST} from '@utils/date';
import {PromisesDueCard} from './PromisesDue';
import {VisitOutcomeSheet} from './VisitOutcomeSheet';

jest.setTimeout(60_000); // the day list loads many modules the first time
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
const mockSheet = jest.fn();
jest.mock('@features/customers/presentation/components/ReceivePaymentSheet', () => ({
  ReceivePaymentSheet: (p: object) => { mockSheet(p); return null; },
}));
const mockDue = jest.fn();
jest.mock('@features/beats/data/beats.remote', () => ({
  beatsRemote: {promisesDue: () => mockDue()},
}));
const mockCollect = jest.fn();
let mockBeats: object[] = [];
jest.mock('@features/beats/presentation/hooks', () => ({
  BEATS_KEY: 'beats',
  useCollectOnBeat: () => ({mutate: (...a: unknown[]) => mockCollect(...a), isPending: false}),
  useDayList: () => ({data: mockBeats, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn()}),
  useRecordVisit: () => ({mutate: jest.fn(), isPending: false}),
}));
jest.mock('@features/beats/data/visitQueue', () => ({
  makeVisitClientId: () => 'v1',
  useVisitQueue: (pick: (s: object) => unknown) => pick({pending: []}),
}));

const lastSheet = () => mockSheet.mock.calls[mockSheet.mock.calls.length - 1][0];
const byId = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && n.props.onPress);
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

async function mount(el: React.ReactElement, role = 'staff') {
  useAuthStore.setState({business: {id: 'b1', businessName: 'Gupta Traders', role} as never});
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>);
  });
  await act(async () => { await new Promise(res => setTimeout(res, 10)); });
  return r;
}

beforeEach(() => {
  mockSheet.mockClear();
  mockCollect.mockClear();
});

const due: PromiseDue[] = [
  {customerId: 'late', fullName: 'Late Traders', businessName: null, outstandingAmount: 3000, beatId: 'north',
    beatName: 'North', date: '2026-11-25', amount: 1200, remaining: 1200, overdue: true},
  {customerId: 'gupta', fullName: 'Gupta Stores', businessName: null, outstandingAmount: 8000, beatId: 'north',
    beatName: 'North', date: todayIST(), amount: 5000, remaining: 3000, overdue: false},
];

test('home: promises due on every beat; tap one to receive what is left, on its beat', async () => {
  mockDue.mockResolvedValue(due);
  const r = await mount(<PromisesDueCard />);
  expect(text(r)).toContain('Promises due today');
  expect(byId(r, 'promise-late')).not.toHaveLength(0);
  expect(r.root.findAll(n => n.props.testID === 'promise-overdue-late').length).toBeGreaterThan(0);
  expect(r.root.findAll(n => n.props.testID === 'promise-overdue-gupta')).toHaveLength(0);
  expect(text(r)).toContain('of ₹5,000 promised'); // part paid: ₹3,000 left
  await act(async () => byId(r, 'promise-gupta')[0].props.onPress());
  expect(lastSheet()).toMatchObject({visible: true, customerId: 'gupta', dayBeatId: 'north', initialAmount: 3000,
    outstanding: 8000});
  await act(async () => lastSheet().onSubmit({amount: 3000, method: 'cash'}));
  expect(mockCollect.mock.calls[0][0]).toEqual({customerId: 'gupta', input: {amount: 3000, method: 'cash', beatId: 'north'}});
  act(() => r.unmount());
});

test('home: nothing due, or an accountant (who can’t collect): no card', async () => {
  mockDue.mockResolvedValue([]);
  let r = await mount(<PromisesDueCard />);
  expect(r.toJSON()).toBeNull();
  act(() => r.unmount());
  mockDue.mockClear().mockResolvedValue(due);
  r = await mount(<PromisesDueCard />, 'accountant');
  expect(r.toJSON()).toBeNull();
  expect(mockDue).not.toHaveBeenCalled();
  act(() => r.unmount());
});

const retailer = (id: string, promise: BeatRetailer['promise']): BeatRetailer => ({
  customerId: id, fullName: id.toUpperCase(), businessName: null, visitOrder: 0, outstandingAmount: 5000,
  overdueAmount: 0, creditLimit: null, lastPromiseDate: promise?.date ?? null, promise, todayVisit: null,
});

test('day list: today’s and overdue promises at the top of the beat, not later ones', async () => {
  mockBeats = [{id: 'north', name: 'North', weekdays: [], assignedUserId: null, version: 1, assignments: [], retailers: [
    retailer('soon', {date: '2099-01-01', amount: 900, remaining: 900}),
    retailer('today', {date: todayIST(), amount: 5000, remaining: 5000}),
    retailer('kept', null),
  ]}];
  const r = await mount(<BeatDayListScreen navigation={{navigate: jest.fn()} as never} route={{params: {}} as never} />);
  expect(byId(r, 'promise-today')).not.toHaveLength(0);
  expect(byId(r, 'promise-soon')).toHaveLength(0);
  expect(byId(r, 'promise-kept')).toHaveLength(0);
  await act(async () => byId(r, 'promise-today')[0].props.onPress());
  expect(lastSheet()).toMatchObject({visible: true, customerId: 'today', dayBeatId: 'north', initialAmount: 5000});
  act(() => r.unmount());
});

test('visit sheet: the promised amount starts as the dues and goes with the date', async () => {
  const onSave = jest.fn();
  const r = await mount(<VisitOutcomeSheet visible retailerName="Gupta" dues={6500} onClose={jest.fn()} onSave={onSave} />);
  const chip = (label: string) => r.root.findAll(n => n.props.label === label && n.props.onPress)[0];
  await act(async () => chip('Visited · no order').props.onPress());
  await act(async () => chip('Will order later').props.onPress());
  await act(async () => chip('＋ Add promise date').props.onPress());
  expect(r.root.findByType(AmountInput).props.value).toBe(6500);
  await act(async () => r.root.findByType(AmountInput).props.onChange(5000));
  const save = r.root.findAll(n => n.props.title === 'Save visit' && n.props.onPress)[0];
  await act(async () => save.props.onPress());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({promiseAmount: 5000, promiseDate: expect.any(String)}));
  act(() => r.unmount());
});
