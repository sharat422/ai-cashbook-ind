/**
 * Save on the cash counter: records today's count the way Daily close's "Save count"
 * does (owner: the whole business; staff: their beat), with the notes and coins
 * counted in the note, and says what was saved.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, TextInput} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useAuthStore} from '@store/auth.store';
import {todayIST} from '@utils/date';
import {CashCounterScreen} from './CashCounterScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
const mockCashCount = jest.fn();
jest.mock('@features/reconciliation/data/reconciliation.remote', () => ({
  reconciliationRemote: {cashCount: (...a: unknown[]) => mockCashCount(...a)},
}));
jest.mock('@features/beats/data/beats.remote', () => ({
  beatsRemote: {list: async () => [{id: 'north', name: 'North'}]},
}));

const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
};

async function render(role: 'owner' | 'staff') {
  useAuthStore.setState({business: {role}} as never);
  const navigate = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient()}>
      <CashCounterScreen navigation={{navigate} as never} route={{} as never} />
    </QueryClientProvider>);
  });
  await settle();
  const inputs = r.root.findAllByType(TextInput);
  const save = () => r.root.findAll(n => n.props.testID === 'cash-save' && n.props.onPress)[0];
  return {r, inputs, save, navigate};
}

beforeEach(() => {
  mockCashCount.mockReset().mockResolvedValue({cashOverShort: '-50.00'});
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => {});
});

test('nothing counted: Save is off', async () => {
  const {r, save} = await render('owner');
  expect(save().props.disabled).toBe(true);
  act(() => r.unmount());
});

test.each([
  ['owner', undefined],
  ['staff', 'north'],
] as const)('%s saves today\'s count (beat: %s) with the notes counted', async (role, beat) => {
  const {r, inputs, save, navigate} = await render(role);
  // Rows are ₹2000, ₹500, ₹200, ₹100…: 10 × ₹500 and 8 × ₹100 = ₹5,800.
  await act(async () => inputs[1].props.onChangeText('10'));
  await act(async () => inputs[3].props.onChangeText('8'));
  expect(save().props.disabled).toBe(false);
  await act(async () => save().props.onPress());
  expect(mockCashCount).toHaveBeenCalledWith(todayIST(), beat, '5800.00', undefined, '₹500×10, ₹100×8');
  const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('Count saved');
  expect(message).toBe('Cash counted ₹5,800\nShort by ₹50.00');
  buttons[1].onPress(); // "Daily close"
  expect(navigate).toHaveBeenCalledWith('DailyClose', beat ? {beatId: beat} : undefined);
  act(() => r.unmount());
});

test('a failed save says so and keeps the count', async () => {
  mockCashCount.mockRejectedValueOnce(new Error('Pick your beat to count its cash.'));
  const {r, inputs, save} = await render('staff');
  await act(async () => inputs[1].props.onChangeText('2'));
  await act(async () => save().props.onPress());
  expect(Alert.alert).toHaveBeenCalledWith('Could not save', 'Pick your beat to count its cash.');
  expect(inputs[1].props.value).toBe('2');
  act(() => r.unmount());
});
