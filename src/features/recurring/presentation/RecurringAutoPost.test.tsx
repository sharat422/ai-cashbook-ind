/**
 * Recurring expenses and income: the form sets the type and whether it records
 * itself on the due date; the list shows income in green, "Auto", when it last
 * recorded itself and what's coming up; the owner is told in the 🔔 inbox.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {RecurringExpense} from '@features/recurring/domain/entities';
import {useAuthStore} from '@store/auth.store';
import {todayIST} from '@utils/date';
import {notifyAutoPosts} from './AutoPostNotifier';
import {RecurringFormScreen} from './screens/RecurringFormScreen';
import {RecurringListScreen} from './screens/RecurringListScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
const mockNotify = jest.fn(async (_payload: unknown) => ['in-app']);
jest.mock('@/services/notifications', () => ({notificationService: {notify: (p: unknown) => mockNotify(p)}}));
let mockItems: RecurringExpense[] = [];
const mockCreate = jest.fn();
jest.mock('@features/recurring/data/recurring.remote', () => ({
  recurringRemote: {
    list: async () => ({items: mockItems, dueCount: 0, dueTotal: 0, monthlyTotal: 0, incomeMonthlyTotal: 0}),
    create: (...a: unknown[]) => mockCreate(...a),
  },
}));

const day = (n: number) => new Date(Date.parse(`${todayIST()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const rec = (over: Partial<RecurringExpense>): RecurringExpense => ({
  id: 'r1', name: 'Shop rent', amount: 10000, category: 'Rent', vendor: '', frequency: 'monthly', interval: 1,
  nextDueDate: day(30), notes: undefined, active: true, kind: 'expense', autoPost: true, anchorDay: null,
  lastPostedDate: null, lastAutoPostedAt: null, isDue: false, createdAt: 'x', ...over,
});

async function mount(el: React.ReactElement) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>);
  });
  await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  return r;
}
const texts = (r: ReactTestRenderer) => r.root.findAll(n => (n.type as unknown) === 'Text')
  .map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' | ');

beforeEach(async () => {
  mockNotify.mockClear();
  await AsyncStorage.clear();
  useAuthStore.setState({token: 't', business: {id: 'b1', businessName: 'Gupta Traders', role: 'owner'}} as never);
});

test('the owner is told once about each auto-post, not about old ones; staff are not told', async () => {
  const now = Date.now();
  mockItems = [
    rec({id: 'rent', lastPostedDate: todayIST(), lastAutoPostedAt: new Date(now - 3600_000).toISOString()}),
    rec({id: 'tenant', name: 'Rent from Ravi', kind: 'income', amount: 4000, lastPostedDate: todayIST(),
      lastAutoPostedAt: new Date(now - 60_000).toISOString()}),
    rec({id: 'old', lastAutoPostedAt: new Date(now - 30 * 86_400_000).toISOString()}),
    rec({id: 'manual', autoPost: false}),
  ];
  expect(await notifyAutoPosts(now)).toBe(2);
  const titles = mockNotify.mock.calls.map(c => c[0] as {title: string; body: string});
  expect(titles.map(x => x.title)).toEqual(['🔁 Shop rent recorded', '🔁 Rent from Ravi recorded']);
  expect(titles[1].body).toContain('₹4,000 income recorded automatically');
  expect(await notifyAutoPosts(now)).toBe(0); // already told
  useAuthStore.setState({business: {id: 'b1', businessName: 'Gupta Traders', role: 'staff'}} as never);
  await AsyncStorage.clear();
  expect(await notifyAutoPosts(now)).toBe(0);
});

test('the list: income in green with +, Auto, when it recorded itself, and the next 7 days', async () => {
  mockItems = [
    rec({id: 'rent', nextDueDate: day(3), lastAutoPostedAt: '2026-11-01T01:07:00+00:00'}),
    rec({id: 'tenant', name: 'Rent from Ravi', kind: 'income', amount: 4000, nextDueDate: day(5), autoPost: false}),
    rec({id: 'far', name: 'Insurance', nextDueDate: day(40)}),
  ];
  const r = await mount(<RecurringListScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />);
  const shown = texts(r);
  expect(shown).toContain('+ ₹4,000');
  expect(r.root.findAll(n => n.props.testID === 'recurring-auto-rent').length).toBeGreaterThan(0);
  expect(r.root.findAll(n => n.props.testID === 'recurring-auto-tenant')).toHaveLength(0);
  expect(r.root.findAll(n => n.props.testID === 'recurring-autoposted-rent').length).toBeGreaterThan(0);
  const upcoming = r.root.findAll(n => n.props.testID === 'recurring-upcoming')[0];
  const soon = texts({root: upcoming} as ReactTestRenderer);
  expect(soon).toContain('Shop rent');
  expect(soon).toContain('Rent from Ravi');
  expect(soon).not.toContain('Insurance');
  act(() => r.unmount());
});

test('the form: a recurring income, with its own categories and no Paid to, records itself by default', async () => {
  mockCreate.mockReset().mockResolvedValue(rec({}));
  mockItems = [];
  const r = await mount(<RecurringFormScreen navigation={{goBack: jest.fn()} as never} route={{params: undefined} as never} />);
  const seg = (value: unknown) => r.root.findAll(n => Array.isArray(n.props.options)
    && n.props.options.some((o: {value: unknown}) => o.value === value) && n.props.onChange)[0];
  await act(async () => seg('income').props.onChange('income'));
  await act(async () => r.root.findAll(n => n.props.placeholder && n.props.onChangeText && n.props.maxLength === 120)[0]
    .props.onChangeText('Rent from Ravi'));
  await act(async () => r.root.findAll(n => n.props.onChange && typeof n.props.value === 'number')[0].props.onChange(4000));
  await act(async () => r.root.findAll(n => n.props.title === 'Add recurring income' && n.props.onPress)[0].props.onPress());
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'income', autoPost: true, name: 'Rent from Ravi', amount: 4000, category: 'Sales', vendor: ''}));
  act(() => r.unmount());
});
