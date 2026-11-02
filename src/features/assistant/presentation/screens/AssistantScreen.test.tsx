import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';

import {AssistantScreen} from './AssistantScreen';

// The first render loads the whole screen (~1.3 s on a fast laptop); slower CI
// runners can pass Jest's default 5 s limit, so allow more.
jest.setTimeout(20_000);

const mockVoice = {
  state: 'idle',
  start: jest.fn(),
  finish: jest.fn(),
  stop: jest.fn(),
  options: undefined as any,
};
jest.mock('@features/ai-entry/presentation/hooks/useLiveVoice', () => ({
  useLiveVoice: (options: any) => {
    mockVoice.options = options;
    return mockVoice;
  },
}));
jest.mock('@features/ai-entry/data/liveVoice', () => ({isLiveVoiceAvailable: () => true}));

const mockMutate = jest.fn();
const mockFeedback = jest.fn();
jest.mock('@features/assistant/presentation/hooks', () => ({
  useAsk: () => ({mutate: mockMutate, isPending: false}),
  useAnswerFeedback: () => ({mutate: mockFeedback}),
}));
const mockGetCustomer = jest.fn();
jest.mock('@features/customers/data/customer.repository', () => ({
  customerRepository: {getById: (id: string) => mockGetCustomer(id)},
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));

const navigation = {navigate: jest.fn()} as any;
const render = () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<AssistantScreen navigation={navigation} route={{} as any} />);
  });
  return tree;
};
/** The button whose label is exactly `label`. */
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAll(n => n.props.accessibilityRole === 'button' && typeof n.type !== 'string')
    .find(n => n.findAllByType(Text).some(t => t.props.children === label))!;
const byTestId = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockVoice.state = 'idle';
});

it('tap the mic to start (no holding); Ask AI purpose with a 60 s cap', () => {
  const tree = render();
  act(() => byTestId(tree, 'mic-button').props.onPress());
  expect(mockVoice.start).toHaveBeenCalledTimes(1);
  expect(mockVoice.options).toMatchObject({purpose: 'chatbot', maxMs: 59_500});
});

it('tap again (⏹) to stop: finishes the recording', () => {
  mockVoice.state = 'recording';
  const tree = render();
  const mic = byTestId(tree, 'mic-button');
  expect(mic.findAllByType(Text)[0].props.children).toBe('⏹');
  act(() => mic.props.onPress());
  expect(mockVoice.finish).toHaveBeenCalledTimes(1);
  expect(mockVoice.start).not.toHaveBeenCalled();
});

it('words appear in the text box as spoken; the user edits and taps ➤ to ask', () => {
  const tree = render();
  act(() => byTestId(tree, 'mic-button').props.onPress());
  act(() => mockVoice.options.onText('Ramesh ka'));
  expect(byTestId(tree, 'question-input').props.value).toBe('Ramesh ka');
  act(() => mockVoice.options.onComplete('Ramesh ka balanse kitna hai')); // final replaces live text
  expect(mockMutate).not.toHaveBeenCalled(); // nothing is sent by itself
  const box = byTestId(tree, 'question-input');
  expect(box.props.value).toBe('Ramesh ka balanse kitna hai');
  act(() => box.props.onChangeText('Ramesh ka balance kitna hai'));
  const send = byTestId(tree, 'send-button');
  act(() => send.props.onPress());
  expect(mockMutate.mock.calls[0][0]).toEqual({
    text: 'Ramesh ka balance kitna hai',
    inputMode: 'voice',
    selectedCustomerId: undefined,
    languageHint: 'en', // the default app language
  });
});

it.each([
  ['an unclear transcript', () => mockVoice.options.onComplete('haan')],
  ['no speech', () => mockVoice.options.onError(Object.assign(new (require('@api/client').ApiError)(422, 'No speech detected.')))],
])('%s -> "I didn\'t catch that" and the text box, nothing sent', (_label, trigger) => {
  const tree = render();
  act(trigger);
  expect(byTestId(tree, 'voice-notice').props.children).toBe(
    "I didn't catch that - try again or type it.",
  );
  expect(mockMutate).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(TextInput).length).toBe(1); // typed fallback
});

it('renders the answer with amounts bold, customer choices, and an open-screen button', () => {
  const tree = render();
  act(() => mockVoice.options.onComplete('ramesh ka balance batao'));
  const send = byTestId(tree, 'send-button');
  act(() => send.props.onPress());
  const {onSuccess} = mockMutate.mock.calls[0][1];
  act(() =>
    onSuccess({
      answer: 'Kaun sa Ramesh? As of 31 Oct 2026 TEST Ramesh owes ₹1,999.90.',
      verified: true,
      dataSource: 'database',
      candidates: [{customerId: 'c2', name: 'TEST Ramesh Traders', businessName: null, mobileMasked: '***0001'}],
      sources: ['send-reminder.md'],
      suggestedScreen: {screen: 'Customers', label: 'Customers'},
    }),
  );
  const bold = tree.root
    .findAllByType(Text)
    .filter(t => String(t.props.className).includes('text-sm font-bold'))
    .map(t => t.props.children);
  expect(bold).toEqual(['31 Oct 2026', '₹1,999.90']);

  // Picking a candidate re-asks the same question with that customer's id.
  const choice = button(tree, 'TEST Ramesh Traders');
  act(() => choice.props.onPress());
  expect(mockMutate.mock.calls[1][0]).toEqual({
    text: 'ramesh ka balance batao',
    inputMode: 'text',
    selectedCustomerId: 'c2',
    languageHint: 'en',
  });

  const open = button(tree, 'Open Customers');
  act(() => open.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('Customers');
});

it('never navigates to a screen outside the allow-list', () => {
  const tree = render();
  act(() => mockVoice.options.onComplete('kuch bhi poocho'));
  const send = byTestId(tree, 'send-button');
  act(() => send.props.onPress());
  act(() =>
    mockMutate.mock.calls[0][1].onSuccess({
      answer: 'x', verified: true, dataSource: 'help_docs', candidates: [], sources: [],
      suggestedScreen: {screen: 'DeleteAccount', label: 'Delete account'},
    }),
  );
  const open = button(tree, 'Open Delete account');
  act(() => open.props.onPress());
  expect(navigation.navigate).not.toHaveBeenCalled();
});


// --- Phase 5: New chat, date range, View details, feedback, limits ----------

const ANSWER = {
  questionId: 'q1',
  answer: 'As of today TEST Ramesh owes ₹3,500.',
  verified: true,
  blocked: null,
  dataSource: 'database',
  candidates: [],
  sources: [],
  suggestedScreen: null,
  period: {asOf: '2026-10-31'},
  viewDetails: {screen: 'CustomerProfile', customerId: 'c1'},
};

const askAndAnswer = (tree: ReactTestRenderer, answer: object = ANSWER) => {
  act(() => mockVoice.options.onComplete('TEST Ramesh ka balance'));
  act(() => byTestId(tree, 'send-button').props.onPress());
  act(() => mockMutate.mock.calls.at(-1)[1].onSuccess(answer));
};

it('shows the date range and opens the customer from View details', async () => {
  const tree = render();
  askAndAnswer(tree);
  expect(byTestId(tree, 'answer-period').props.children).toBe('As of 31 Oct 2026');
  const customer = {id: 'c1', fullName: 'TEST Ramesh'};
  mockGetCustomer.mockResolvedValueOnce(customer);
  await act(async () => {
    await button(tree, 'View details').props.onPress();
  });
  expect(mockGetCustomer).toHaveBeenCalledWith('c1');
  expect(navigation.navigate).toHaveBeenCalledWith('CustomerProfile', {customer});
});

it('shows a from-to range and opens a list screen directly', () => {
  const tree = render();
  askAndAnswer(tree, {
    ...ANSWER,
    period: {from: '2026-10-01', to: '2026-10-31'},
    viewDetails: {screen: 'TransactionHistory'},
  });
  expect(byTestId(tree, 'answer-period').props.children).toBe('01 Oct 2026 – 31 Oct 2026');
  act(() => button(tree, 'View details').props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('TransactionHistory');
});

it('thumbs down with a note is sent with the question id', () => {
  const tree = render();
  askAndAnswer(tree);
  act(() => byTestId(tree, 'feedback-down').props.onPress());
  expect(mockFeedback).toHaveBeenLastCalledWith({questionId: 'q1', rating: 'down'});
  act(() => byTestId(tree, 'feedback-note').props.onChangeText('amount is wrong'));
  act(() => byTestId(tree, 'feedback-send').props.onPress());
  expect(mockFeedback.mock.calls.at(-1)[0]).toEqual({
    questionId: 'q1',
    rating: 'down',
    note: 'amount is wrong',
  });
});

it('New chat clears the conversation and stops the mic', () => {
  const tree = render();
  askAndAnswer(tree);
  expect(byTestId(tree, 'answer-period')).toBeDefined();
  act(() => byTestId(tree, 'new-chat').props.onPress());
  expect(byTestId(tree, 'answer-period')).toBeUndefined();
  expect(byTestId(tree, 'new-chat')).toBeUndefined();
  expect(mockVoice.stop).toHaveBeenCalled();
});

it('a rate limit shows the polite server message, not an error dump', () => {
  const {ApiError} = require('@api/client');
  const tree = render();
  act(() => mockVoice.options.onComplete('TEST Ramesh ka balance'));
  act(() => byTestId(tree, 'send-button').props.onPress());
  const polite = "You've reached this hour's limit of 30 questions. Please try again a little later.";
  act(() => mockMutate.mock.calls.at(-1)[1].onError(new ApiError(429, polite)));
  // AI answers render as highlighted segments, so join each Text's children.
  const shown = tree.root.findAllByType(Text).map(t => [t.props.children].flat().join(''));
  expect(shown).toContain(polite);
  expect(shown.some(c => c.startsWith('Sorry'))).toBe(false);
});

it('asks in the app language (Telugu)', () => {
  const {useAuthStore} = require('@store/auth.store');
  act(() => useAuthStore.getState().setPreferredLanguage('te'));
  const tree = render();
  act(() => mockVoice.options.onComplete('నా మొత్తం బాకీ ఎంత'));
  act(() => byTestId(tree, 'send-button').props.onPress());
  expect(mockMutate.mock.calls.at(-1)[0].languageHint).toBe('te');
  act(() => useAuthStore.getState().setPreferredLanguage('en'));
});


it('sending while the final transcript is pending drops the late update', () => {
  mockVoice.state = 'finishing';
  const tree = render();
  act(() => mockVoice.options.onText('aaj ka collection'));
  act(() => byTestId(tree, 'send-button').props.onPress());
  expect(mockVoice.stop).toHaveBeenCalledTimes(1); // late onComplete can't refill the box
  expect(mockMutate.mock.calls[0][0].text).toBe('aaj ka collection');
});

it('a voice error keeps the words heard so far, and they can still be sent', () => {
  const tree = render();
  act(() => byTestId(tree, 'mic-button').props.onPress());
  act(() => mockVoice.options.onText('total udhaar kitna'));
  act(() => mockVoice.options.onError(new Error('Live transcription timed out.')));
  expect(byTestId(tree, 'question-input').props.value).toBe('total udhaar kitna');
  act(() => byTestId(tree, 'send-button').props.onPress());
  expect(mockMutate.mock.calls[0][0]).toMatchObject({text: 'total udhaar kitna', inputMode: 'voice'});
});

it('typed questions are sent as text', () => {
  const tree = render();
  act(() => byTestId(tree, 'question-input').props.onChangeText('who owes me most'));
  act(() => byTestId(tree, 'send-button').props.onPress());
  expect(mockMutate.mock.calls[0][0]).toMatchObject({text: 'who owes me most', inputMode: 'text'});
});
