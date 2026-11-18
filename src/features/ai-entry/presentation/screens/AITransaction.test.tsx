/**
 * AI Entry (MANUAL_TESTING §17): the item ("for groceries") shows as Category
 * and is saved on the entry; the Speak button has no mic pictures; the app's
 * language goes to the server so the customer's name comes back in its script.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text, TextInput} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {apiRequest} from '@api/client';
import {aiEntryRemote} from '@features/ai-entry/data/aiEntry.remote';
import {addLedgerForCustomer} from '@features/ai-entry/domain/saveTransaction';
import {useAuthStore} from '@store/auth.store';
import {AITransactionScreen} from './AITransactionScreen';

jest.mock('@api/client', () => ({
  ...jest.requireActual('@api/client'),
  apiRequest: jest.fn(),
}));
jest.mock('@features/ai-entry/domain/saveTransaction', () => ({
  findCustomerCandidates: jest.fn(async () => []),
  exactMatch: jest.fn(() => null),
  createCustomerByName: jest.fn(async (name: string) => ({id: 'c1', fullName: name})),
  addLedgerForCustomer: jest.fn(async () => undefined),
}));
jest.mock('@features/ai-entry/data/liveVoice', () => ({isLiveVoiceAvailable: () => true}));
jest.mock('@features/ai-entry/presentation/hooks/useLiveVoice', () => ({
  useLiveVoice: () => ({state: 'idle', start: jest.fn(), stop: jest.fn()}),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.setTimeout(60_000);

const api = apiRequest as jest.Mock;
beforeEach(() => api.mockReset());
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map(n => [n.props.children].flat().join(''));
const press = async (r: ReactTestRenderer, title: string) => {
  const b = r.root.findAll(n => typeof n.props.onPress === 'function' && n.props.title === title)[0];
  await act(async () => b.props.onPress());
};

test('"gave ramesh 500 for groceries": Category Groceries, saved on the entry; no mic pictures', async () => {
  api.mockResolvedValueOnce({customer_name: 'Ramesh', type: 'credit', amount: 500, category: 'Groceries',
    date: '2026-11-18', confidence: 0.85, raw_text: 'gave ramesh 500 for groceries', source: 'ai'});
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient()}>
      <AITransactionScreen navigation={{goBack: jest.fn(), replace: jest.fn()} as never} route={{} as never} />
    </QueryClientProvider>);
  });
  expect(texts(r)).toContain('Speak (any language)'); // no 🎤 in the label…
  expect(texts(r)).not.toContain('🎤'); // …and no separate mic icon on the button

  await act(async () => r.root.findAllByType(TextInput)[0].props.onChangeText('gave ramesh 500 for groceries'));
  await press(r, '✨ Read transaction');
  expect(r.root.findByProps({testID: 'ai-category'}).props.value).toBe('Groceries');

  await press(r, 'Confirm & save');
  expect(addLedgerForCustomer).toHaveBeenCalledWith('c1', expect.objectContaining({
    type: 'credit', amount: 500, notes: 'Groceries · Voice/AI: gave ramesh 500 for groceries'}));
  act(() => r.unmount());
});

test('the parse request carries the app language', async () => {
  useAuthStore.setState({preferredLanguage: 'te'} as never);
  api.mockResolvedValueOnce({customer_name: 'నరేన్', type: 'payment', amount: 7000, category: 'Payment',
    date: '2026-11-18', confidence: 0.85, raw_text: 'Naren naku 7000 ichadu', source: 'ai'});
  const out = await aiEntryRemote.parse('Naren naku 7000 ichadu', '2026-11-18');
  expect(api).toHaveBeenLastCalledWith('/parse-transaction', {method: 'POST',
    body: {text: 'Naren naku 7000 ichadu', today: '2026-11-18', language: 'te'}});
  expect(out.type).toBe('payment');
});
