/**
 * Settings → Beats: the beat list for every role. Staff get only the beats the
 * server sends them (their own) with the day-list, ledger and visits but no
 * create / edit / delete; the owner gets those too. A beat's Ledger opens its
 * beat ledger; the salesperson's name comes from the beat when there's no team list.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {Beat} from '@features/beats/data/beats.remote';
import {BeatPlanScreen} from './BeatPlanScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('@features/customers/presentation/hooks/useCustomers', () => ({useCustomers: () => ({data: []})}));

let mockRole: 'owner' | 'staff' = 'staff';
jest.mock('@features/auth/hooks', () => ({
  usePermissions: () => ({role: mockRole, can: (p: string) => mockRole === 'owner' || p === 'entry.create'}),
}));
const mockTeam = jest.fn((enabled: boolean) => ({data: enabled ? [] : undefined}));
jest.mock('@features/team/presentation/hooks', () => ({useTeam: (enabled: boolean) => mockTeam(enabled)}));
const north = (): Beat => ({
  id: 'north', name: 'North', version: 1, weekdays: [0, 3], assignedUserId: 'ravi', retailers: [],
  assignments: [{userId: 'ravi', role: 'primary', name: 'Ravi', mobile: null, validFrom: '2026-11-01', validTo: null}],
});
jest.mock('@features/beats/data/beats.remote', () => ({
  beatsRemote: {list: async () => [north()], listDeleted: async () => []},
  isBeatChanged: () => false,
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' | ');
const has = (r: ReactTestRenderer, id: string) => r.root.findAllByProps({testID: id}).length > 0;

async function render(): Promise<{r: ReactTestRenderer; navigate: jest.Mock}> {
  const navigate = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
      <BeatPlanScreen navigation={{navigate} as never} route={{} as never} />
    </QueryClientProvider>);
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  return {r, navigate};
}

test('staff: their beat with day-list, ledger and visits, but nothing to create or change', async () => {
  mockRole = 'staff';
  const {r, navigate} = await render();
  const text = textOf(r);
  expect(text).toContain('Beats');
  expect(text).toContain('North');
  expect(text).toContain('Ravi'); // from the beat itself: staff can't list the team
  expect(mockTeam).toHaveBeenLastCalledWith(false);
  expect(text).not.toContain('New beat');
  for (const id of ['beat-edit-north', 'beat-delete-north', 'beats-show-deleted']) expect(has(r, id)).toBe(false);
  expect(text).not.toContain('Shops & order');

  const ledger = r.root.findAll(n => n.props.testID === 'beat-ledger-north' && typeof n.props.onPress === 'function')[0];
  await act(async () => ledger.props.onPress());
  expect(navigate).toHaveBeenCalledWith('BeatLedger', {beatId: 'north'});
  act(() => r.unmount());
});

test('owner: the same list with create, edit, order and delete', async () => {
  mockRole = 'owner';
  const {r} = await render();
  expect(textOf(r)).toContain('New beat');
  expect(textOf(r)).toContain('Shops & order');
  for (const id of ['beat-edit-north', 'beat-delete-north', 'beats-show-deleted', 'beat-ledger-north']) {
    expect(has(r, id)).toBe(true);
  }
  act(() => r.unmount());
});
