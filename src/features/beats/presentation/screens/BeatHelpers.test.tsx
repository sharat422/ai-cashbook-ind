/**
 * Beat plan → Edit → helpers: planned cover shows its dates, a helper taken
 * off today is shown as off (tapping adds them back), and a new helper is
 * sent with the start date picked on the screen.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {Beat} from '@features/beats/data/beats.remote';
import {todayIST} from '@utils/date';
import {BeatPlanScreen} from './BeatPlanScreen';

jest.setTimeout(90_000);

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/team/presentation/hooks', () => ({
  useTeam: () => ({data: [
    {userId: 'ravi', name: 'Ravi', mobile: '9000000001', role: 'staff'},
    {userId: 'sita', name: 'Sita', mobile: '9000000002', role: 'staff'},
  ]}),
}));
jest.mock('@features/customers/presentation/hooks/useCustomers', () => ({useCustomers: () => ({data: []})}));

const mockBeat = (): Beat => ({
  id: 'b1', name: 'Ring Road', version: 1, weekdays: [0], assignedUserId: null, retailers: [],
  assignments: [
    {userId: 'ravi', role: 'secondary', name: 'Ravi', mobile: null, validFrom: '2099-01-05', validTo: null},
    {userId: 'sita', role: 'secondary', name: 'Sita', mobile: null, validFrom: todayIST(), validTo: todayIST()},
  ],
});
const mockAddHelper = jest.fn(async () => mockBeat());
jest.mock('@features/beats/data/beats.remote', () => ({
  beatsRemote: {
    list: async () => [mockBeat()],
    listDeleted: async () => [],
    addHelper: (...args: unknown[]) => (mockAddHelper as (...a: unknown[]) => unknown)(...args),
    removeHelper: jest.fn(),
  },
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' ');

test('planned cover shows its dates and a helper taken off today can be added back', async () => {
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      r = create(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <BeatPlanScreen navigation={{navigate: jest.fn()} as any} route={{} as any} />
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise(res => setTimeout(res, 0)); });
    const caption = r.root.findAllByProps({testID: 'beat-team-b1'})[0];
    const captionText = ([] as unknown[]).concat(caption.props.children).join('');
    expect(captionText).toContain('Ravi — from 05 Jan 2099');
    expect(captionText).not.toContain('Sita'); // removed today: no longer listed

    await act(async () => { r.root.findAllByProps({testID: 'beat-edit-b1'})[0].props.onPress(); });
    expect(textOf(r)).toContain('Helper starts on');
    const chip = (who: string) =>
      r.root.findAll(n => typeof n.props.label === 'string' && 'selected' in n.props && n.props.label.startsWith(who)).pop()!; // the helper chip, below the salesperson chips
    expect(chip('Ravi').props.selected).toBe(true);
    expect(chip('Sita').props.selected).toBe(false);
    await act(async () => { chip('Sita').props.onPress(); });
    expect(mockAddHelper).toHaveBeenCalledWith('b1', 'sita', todayIST(), null);
  } finally {
    act(() => r?.unmount());
  }
});
