/**
 * The owner fixes a wrong income from Entry details: the form opens with what
 * was saved, Save sends the corrected values to the server, the phone's copy is
 * replaced and every cached figure (Reports, Dashboard, history) is refetched.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {AmountInput, AttachmentPicker} from '@components/form';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {AddIncomeScreen} from './AddIncomeScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
const mockUpdate = jest.fn();
jest.mock('@features/income/data/income.remote', () => ({
  incomeRemote: {update: (...a: unknown[]) => mockUpdate(...a)},
}));

const edit = {id: 'inc1', kind: 'income' as const, amount: 5000, category: 'Sales', date: '2026-11-15',
  notes: 'Ramesh, cash', syncStatus: 'synced' as const};

test('the form opens with the saved income and Save sends the fix', async () => {
  const fixed = {...edit, amount: 500, createdAt: 'x'};
  mockUpdate.mockResolvedValue(fixed);
  useIncomeStore.setState({entries: [{...edit, createdAt: 'x'} as never]});
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => {});
  const client = new QueryClient();
  const refetchAll = jest.spyOn(client, 'invalidateQueries');
  const navigation = {pop: jest.fn(), goBack: jest.fn()};
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={client}>
      <AddIncomeScreen navigation={navigation as never} route={{params: {edit}} as never} />
    </QueryClientProvider>);
  });

  expect(r.root.findByType(AmountInput).props.value).toBe(5000);
  expect(r.root.findAllByType(AttachmentPicker)).toHaveLength(0); // the photo stays as it is
  await act(async () => r.root.findByType(AmountInput).props.onChange(500));
  await act(async () => r.root.findAll(n => n.props.testID === 'income-save' && n.props.onPress)[0].props.onPress());

  expect(mockUpdate).toHaveBeenCalledWith('inc1', {amount: 500, category: 'Sales', date: '2026-11-15', notes: 'Ramesh, cash'});
  expect(useIncomeStore.getState().entries[0].amount).toBe(500);
  expect(refetchAll).toHaveBeenCalledWith();
  const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('Income updated');
  buttons[0].onPress();
  expect(navigation.pop).toHaveBeenCalledWith(2); // past Entry details (it shows the old figures) to the list
  act(() => r.unmount());
});
