/** ST7 on the phone: the owner previews who a bulk send reaches, sends after
 *  a confirm, sees why a batch stopped, and turns the monthly send off in one tap. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {BulkStatementsScreen} from './BulkStatementsScreen';

jest.setTimeout(60_000); // the first test also loads the screen's modules
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/beats/data/beats.remote', () => ({beatsRemote: {list: async () => []}}));
let mockTemplate = 'APPROVED';
const mockSend = jest.fn(async () => ({sent: 5, notOptedIn: 2, alreadyToday: 0, noMobile: 0, failed: 5, notTried: 10,
  stopped: 'Stopped: 5 of 10 sends failed (over 10%). Last error: WhatsApp refused (131026): Message undeliverable.'}));
const mockSetSchedule = jest.fn(async (s: object) => s);
jest.mock('@features/customers/data/statements.remote', () => ({
  statementsRemote: {
    bulkPreview: async () => ({total: 22, optedIn: 20, notOptedIn: 2, alreadyToday: 0, noMobile: 0, willSend: 20,
      template: 'statement_ready', templateStatus: mockTemplate, inWindow: true}),
    bulkSend: () => mockSend(),
    schedule: async () => ({enabled: true, day: 1, hour: 10, beatId: null, lastRunMonth: null, lastResult: null}),
    setSchedule: (s: object) => mockSetSchedule(s),
  },
}));

/** Let the queries resolve: a few short waits, so a busy machine doesn't make the test flaky. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)); });
};
const text = (r: ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id)[0].findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children).join(' ');

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient()}>
      <BulkStatementsScreen navigation={{} as any} route={{} as any} />
    </QueryClientProvider>);
  });
  await settle();
  return r;
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSend.mockClear();
  mockTemplate = 'APPROVED';
});

test('preview, confirm, send — and a stopped batch says why', async () => {
  const r = await render();
  expect(text(r, 'bulk-preview')).toContain('Will send: 20');
  await act(async () => { r.root.findAll(n => n.props.testID === 'bulk-send' && n.props.onPress)[0].props.onPress(); });
  expect(mockSend).not.toHaveBeenCalled();  // asks first
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  await act(async () => { buttons.at(-1).onPress(); });
  await settle();
  expect(text(r, 'bulk-stopped')).toContain('5 of 10 sends failed');
  act(() => r.unmount());
});

test('without an approved template the send is off and says so; the schedule turns off in one tap', async () => {
  mockTemplate = 'PENDING';
  const r = await render();
  expect(text(r, 'bulk-blocked')).toContain('PENDING');
  expect(r.root.findAll(n => n.props.testID === 'bulk-send' && 'disabled' in n.props)[0].props.disabled).toBe(true);
  const toggle = r.root.findAll(n => n.props.onChange && Array.isArray(n.props.options))[0];
  await act(async () => { toggle.props.onChange(false); });
  expect(mockSetSchedule).toHaveBeenCalledWith(expect.objectContaining({enabled: false}));
  act(() => r.unmount());
});
