/**
 * The owner fixes a wrongly typed expense from Entry details: the form opens with
 * what was saved (no voice entry, no photo picker), Save sends the fix, the
 * phone's copy is replaced and every cached figure is refetched.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {AmountInput, AttachmentPicker, TextField} from '@components/form';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {AddExpenseScreen} from './AddExpenseScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/ai-entry/data/voiceRecorder', () => ({
  isVoiceAvailable: () => true, startRecording: jest.fn(), stopRecording: jest.fn(), ensureMicPermission: jest.fn(),
}));
const mockUpdate = jest.fn();
jest.mock('@features/expense/data/expense.remote', () => ({
  expenseRemote: {update: (...a: unknown[]) => mockUpdate(...a)},
}));

const edit = {id: 'exp1', kind: 'expense' as const, amount: 8000, category: 'Fuel', date: '2026-11-15',
  vendor: 'HP Petrol', notes: 'diesel', syncStatus: 'synced' as const};

test('the form opens with the saved expense and Save sends the fix', async () => {
  mockUpdate.mockResolvedValue({...edit, amount: 800, createdAt: 'x'});
  useExpenseStore.setState({entries: [{...edit, createdAt: 'x'} as never]});
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => {});
  const client = new QueryClient();
  const refetchAll = jest.spyOn(client, 'invalidateQueries');
  const navigation = {pop: jest.fn(), goBack: jest.fn()};
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={client}>
      <AddExpenseScreen navigation={navigation as never} route={{params: {edit}} as never} />
    </QueryClientProvider>);
  });

  expect(r.root.findByType(AmountInput).props.value).toBe(8000);
  expect(r.root.findByType(TextField).props.value).toBe('HP Petrol');
  expect(r.root.findAllByType(AttachmentPicker)).toHaveLength(0);
  expect(JSON.stringify(r.toJSON())).not.toContain('🎤'); // no voice entry while fixing
  await act(async () => r.root.findByType(AmountInput).props.onChange(800));
  await act(async () => r.root.findAll(n => n.props.testID === 'expense-save' && n.props.onPress)[0].props.onPress());

  expect(mockUpdate).toHaveBeenCalledWith('exp1', {amount: 800, category: 'Fuel', vendor: 'HP Petrol', date: '2026-11-15', notes: 'diesel'});
  expect(useExpenseStore.getState().entries[0].amount).toBe(800);
  expect(refetchAll).toHaveBeenCalledWith();
  const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('Expense updated');
  buttons[0].onPress();
  expect(navigation.pop).toHaveBeenCalledWith(2);
  act(() => r.unmount());
});
