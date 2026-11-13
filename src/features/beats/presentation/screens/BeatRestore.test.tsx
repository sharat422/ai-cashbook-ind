/**
 * Beat plan → Deleted beats → Restore → confirm: the server is asked to
 * restore, and a beat with no salesperson says "pick one".
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {Beat} from '@features/beats/data/beats.remote';
import {BeatPlanScreen} from './BeatPlanScreen';

jest.setTimeout(90_000);

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/team/presentation/hooks', () => ({useTeam: () => ({data: []})}));
jest.mock('@features/customers/presentation/hooks/useCustomers', () => ({useCustomers: () => ({data: []})}));

const beat = (id: string, name: string): Beat => ({
  id, name, version: 1, weekdays: [0], assignedUserId: null, assignments: [], retailers: [],
});
const mockRestore = jest.fn(async (id: string) => beat(id, 'Old Town'));
jest.mock('@features/beats/data/beats.remote', () => ({
  beatsRemote: {
    list: async () => [beat('live', 'Ring Road')],
    listDeleted: async () => [beat('gone', 'Old Town')],
    restore: (id: string) => mockRestore(id),
  },
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' ');

test('a deleted beat is restored after the owner confirms', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  let r!: ReactTestRenderer;
  try {
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <BeatPlanScreen navigation={{navigate: jest.fn()} as any} route={{} as any} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); }); // the list query resolves
  expect(textOf(r)).toContain('No salesperson — pick one');
  await act(async () => { r.root.findAllByProps({testID: 'beats-show-deleted'})[0].props.onPress(); });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  expect(r.root.findAllByProps({testID: 'deleted-beat-gone'}).length).toBeGreaterThan(0);

  await act(async () => { r.root.findAllByProps({testID: 'beat-restore-gone'})[0].props.onPress(); });
  expect(mockRestore).not.toHaveBeenCalled(); // asks first
  const [, , buttons] = alert.mock.calls[0];
  await act(async () => { buttons!.find(b => b.style !== 'cancel')!.onPress!(); });
  expect(mockRestore).toHaveBeenCalledWith('gone');
  } finally {
    act(() => r?.unmount()); // a render left running crashes Jest after teardown
  }
});
