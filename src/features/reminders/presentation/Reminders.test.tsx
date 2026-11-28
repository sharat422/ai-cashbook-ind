/**
 * Reminders on the phone: the send sheet shows the shared history (automatic
 * ones and who sent the rest) and records a reminder sent by hand on the
 * server; the day list's "To chase today" says why and whether it goes by
 * itself; the owner's rules screen saves who gets chased and when.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Linking} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {DueReminder, ServerReminder} from '@features/reminders/data/reminders.remote';
import {useAuthStore} from '@store/auth.store';
import {DueRemindersCard} from './components/DueRemindersCard';
import {SendReminderSheet} from './components/SendReminderSheet';
import {ReminderRulesScreen} from './screens/ReminderRulesScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/beats/presentation/hooks', () => ({useBeats: () => ({data: [{id: 'north', name: 'North'}]})}));
let mockHistory: ServerReminder[] = [];
let mockDue: {auto: boolean; items: DueReminder[]} = {auto: false, items: []};
const mockRecord = jest.fn(async (..._a: unknown[]) => ({}));
const mockSave = jest.fn(async (b: unknown) => b);
jest.mock('@features/reminders/data/reminders.remote', () => ({
  remindersRemote: {
    history: async () => mockHistory,
    record: (...a: unknown[]) => mockRecord(...a),
    due: async () => mockDue,
    rules: async () => ({enabled: false, beforePromiseDays: 1, overdueDays: 3, repeatDays: 7, beatId: null}),
    saveRules: (b: unknown) => mockSave(b),
  },
}));

async function mount(el: React.ReactElement) {
  useAuthStore.setState({business: {id: 'b1', businessName: 'Gupta Traders', role: 'owner'}} as never);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>);
  });
  await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  return r;
}
const texts = (r: ReactTestRenderer) => r.root.findAll(n => (n.type as unknown) === 'Text')
  .map(n => ([] as unknown[]).concat(n.props.children)
    .filter(c => typeof c === 'string' || typeof c === 'number').join('')).join(' | ');
const ev = (over: Partial<ServerReminder>): ServerReminder => ({id: 'e1', customerId: 'c1', customerName: 'Gupta', channel:
  'whatsapp_server', reason: 'overdue', status: 'sent', message: 'WhatsApp statement: balance ₹5,000', note: null,
  automatic: true, sentByName: null, createdAt: '2026-11-28T04:37:00+00:00', ...over});

test('the sheet shows the shared history and records a reminder sent from this phone', async () => {
  mockHistory = [ev({id: 'm', channel: 'whatsapp', reason: 'manual', automatic: false, sentByName: 'Ravi', message: 'Hi'}), ev({})];
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const customer = {id: 'c1', fullName: 'Gupta', mobile: '9811100001', outstandingAmount: 5000, isOverdue: true, createdAt: ''};
  const r = await mount(<SendReminderSheet visible customer={customer} outstanding={5000} businessName="Gupta Traders"
    onClose={jest.fn()} />);
  expect(texts(r)).toContain('by Ravi');
  expect(texts(r)).toContain('Automatic WhatsApp statement');
  const send = r.root.findAll(n => typeof n.props.title === 'string' && n.props.title.startsWith('Send') && n.props.onPress)[0];
  await act(async () => send.props.onPress());
  await act(async () => { await new Promise(res => setTimeout(res, 10)); });
  expect(open).toHaveBeenCalledWith(expect.stringContaining('whatsapp://send?phone=919811100001'));
  expect(mockRecord).toHaveBeenCalledWith({customerId: 'c1', channel: 'whatsapp', message: expect.stringContaining('Gupta')});
  act(() => r.unmount());
});

test('the day list: who to chase today, why, and whether it goes by itself', async () => {
  mockDue = {auto: true, items: [
    {customerId: 'c1', fullName: 'Gupta Stores', mobile: '9811100001', outstandingAmount: 5000, reason: 'overdue',
      daysOverdue: 3, lastReminderAt: null, optedIn: true},
    {customerId: 'c2', fullName: 'New Shop', mobile: '9811100002', outstandingAmount: 900, reason: 'promise',
      promiseDate: '2026-11-29', promiseAmount: 900, lastReminderAt: null, optedIn: false},
  ]};
  const onPress = jest.fn();
  const r = await mount(<DueRemindersCard beatId="north" onPress={onPress} />);
  const shown = texts(r);
  expect(shown).toContain('To chase today (2)');
  expect(shown).toContain('Overdue by 3 days');
  expect(shown).toContain('Promised ₹900 for');
  expect(shown).toContain('Gets their WhatsApp statement automatically');
  expect(shown).toContain('Tap to send a reminder (no WhatsApp statement consent');
  await act(async () => r.root.findAll(n => n.props.testID === 'remind-c2' && n.props.onPress)[0].props.onPress());
  expect(onPress).toHaveBeenCalledWith(expect.objectContaining({customerId: 'c2'}));
  act(() => r.unmount());
});

test('the owner turns automatic reminders on for one beat, overdue by 7 days', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const r = await mount(<ReminderRulesScreen />);
  const press = async (label: string) => {
    await act(async () => r.root.findAll(n => n.props.label === label && n.props.onPress)[0].props.onPress());
  };
  await act(async () => r.root.findAll(n => n.props.onChange && Array.isArray(n.props.options)
    && n.props.options.some((o: {value: unknown}) => o.value === true))[0].props.onChange(true));
  await press('North');
  const seven = r.root.findAll(n => n.props.label === '7 days' && n.props.onPress);
  await act(async () => seven[0].props.onPress()); // the overdue row comes before "again every"
  await act(async () => r.root.findAll(n => n.props.testID === 'rules-save' && n.props.onPress)[0].props.onPress());
  expect(mockSave).toHaveBeenCalledWith({enabled: true, beforePromiseDays: 1, overdueDays: 7, repeatDays: 7, beatId: 'north'});
  act(() => r.unmount());
});
