/**
 * Save with something wrong pops up what's wrong (the red text under a field
 * can be scrolled off screen): ₹1,00,00,001 on + Income, nothing filled on
 * − Expense, and Quick Add, which now checks the upper limit too.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, TextInput} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {AddExpenseScreen} from '@features/expense/presentation/screens/AddExpenseScreen';
import {AddIncomeScreen} from '@features/income/presentation/screens/AddIncomeScreen';
import {QuickAddScreen} from '@features/transactions/presentation/screens/QuickAddScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.setTimeout(60_000);

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
beforeEach(() => alert.mockClear());

async function show(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
  });
  return r;
}
const nav = {goBack: jest.fn(), navigate: jest.fn()} as never;
const route = {params: {}} as never;
const pressSave = async (r: ReactTestRenderer) => {
  const save = r.root.findAll(n => typeof n.props.onPress === 'function' && /^Save/.test(String(n.props.title)))[0];
  await act(async () => save.props.onPress());
};
const typeAmount = async (r: ReactTestRenderer, text: string) => {
  await act(async () => r.root.findAllByType(TextInput)[0].props.onChangeText(text));
};

test('+ Income: ₹1,00,00,001 → "Amount looks too large" in a popup', async () => {
  const r = await show(<AddIncomeScreen navigation={nav} route={route} />);
  await typeAmount(r, '1,00,00,001');
  await pressSave(r);
  expect(alert).toHaveBeenCalledWith('Please check', expect.stringContaining('• Amount looks too large'));
  act(() => r.unmount());
});

test('− Expense: nothing filled → amount and category listed', async () => {
  const r = await show(<AddExpenseScreen navigation={nav} route={route} />);
  await pressSave(r);
  expect(alert).toHaveBeenCalledWith('Please check', '• Enter an amount\n• Select a category');
  act(() => r.unmount());
});

test('Quick Add: empty, then too large → a popup each time, nothing saved', async () => {
  const r = await show(<QuickAddScreen navigation={nav} route={{params: {type: 'expense'}} as never} />);
  await pressSave(r);
  expect(alert).toHaveBeenLastCalledWith('Please check', '• Enter an amount');
  await typeAmount(r, '10000001');
  await pressSave(r);
  expect(alert).toHaveBeenLastCalledWith('Please check', '• Amount looks too large');
  act(() => r.unmount());
});
