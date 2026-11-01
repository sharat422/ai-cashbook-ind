import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';

import {AssistantScreen} from './AssistantScreen';

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
jest.mock('@features/assistant/presentation/hooks', () => ({
  useAsk: () => ({mutate: mockMutate, isPending: false}),
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

it('hold to record, release to finish; Ask AI purpose with a 60 s cap', () => {
  const tree = render();
  const mic = byTestId(tree, 'mic-button');
  act(() => mic.props.onPressIn());
  expect(mockVoice.start).toHaveBeenCalledTimes(1);
  act(() => mic.props.onPressOut());
  expect(mockVoice.finish).toHaveBeenCalledTimes(1);
  expect(mockVoice.options).toMatchObject({purpose: 'chatbot', maxMs: 59_500});
});

it('shows the transcript for review, lets the user edit it, and only then sends', () => {
  const tree = render();
  act(() => mockVoice.options.onComplete('Ramesh ka balanse kitna hai'));
  expect(mockMutate).not.toHaveBeenCalled(); // nothing sent before review
  const edit = byTestId(tree, 'transcript-edit');
  expect(edit.props.value).toBe('Ramesh ka balanse kitna hai');
  act(() => edit.props.onChangeText('Ramesh ka balance kitna hai'));
  const send = button(tree, 'Send');
  act(() => send.props.onPress());
  expect(mockMutate.mock.calls[0][0]).toEqual({
    text: 'Ramesh ka balance kitna hai',
    inputMode: 'voice',
    selectedCustomerId: undefined,
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
  expect(byTestId(tree, 'transcript-review')).toBeUndefined();
  expect(mockMutate).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(TextInput).length).toBe(1); // typed fallback
});

it('renders the answer with amounts bold, customer choices, and an open-screen button', () => {
  const tree = render();
  act(() => mockVoice.options.onComplete('ramesh ka balance batao'));
  const send = button(tree, 'Send');
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
  });

  const open = button(tree, 'Open Customers');
  act(() => open.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('Customers');
});

it('never navigates to a screen outside the allow-list', () => {
  const tree = render();
  act(() => mockVoice.options.onComplete('kuch bhi poocho'));
  const send = button(tree, 'Send');
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
