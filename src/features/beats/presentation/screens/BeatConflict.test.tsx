/**
 * IM3: a beat edit is sent with the version it started from. Saved on another
 * phone first → nothing is saved here; the editor closes, the notice shows and
 * the list reloads the current beat to review and edit again.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {ApiError} from '@api/client';
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

let mockServer: Beat = {id: 'b1', name: 'Ring Road', version: 1, weekdays: [0], assignedUserId: null,
  retailers: [], assignments: []};
const NOTICE = 'Ring Road: changed on another phone — review and save again.';
const mockEdit = jest.fn(async (..._a: unknown[]) => {
  // Another phone saved first: the server is now at version 2.
  mockServer = {...mockServer, name: 'Ring Road East', version: 2};
  throw new ApiError(409, NOTICE, NOTICE, 'beat_changed', {beat: 'Ring Road'});
});
jest.mock('@features/beats/data/beats.remote', () => ({
  ...jest.requireActual('@features/beats/data/beats.remote'),
  beatsRemote: {
    list: async () => [mockServer],
    listDeleted: async () => [],
    edit: (...a: unknown[]) => mockEdit(...a),
  },
}));

test('a stale beat edit saves nothing and shows the current beat with the notice', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let r!: ReactTestRenderer;
  const settle = async () => {
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)); });
  };
  try {
    await act(async () => {
      r = create(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <BeatPlanScreen navigation={{navigate: jest.fn()} as any} route={{} as any} />
        </QueryClientProvider>,
      );
    });
    await settle();
    await act(async () => { r.root.findAllByProps({testID: 'beat-edit-b1'})[0].props.onPress(); });
    await act(async () => { r.root.findAllByProps({testID: 'beat-save'})[0].props.onPress(); });
    await settle();
    expect(mockEdit).toHaveBeenCalledWith('b1', {name: 'Ring Road', weekdays: [0], assignedUserId: null}, 1);
    expect(alert).toHaveBeenCalledWith(NOTICE);
    expect(r.root.findAllByProps({testID: 'beat-save'})).toHaveLength(0);       // the editor closed
    const names = r.root.findAll(n => n.props.children === 'Ring Road East');    // the current beat, reloaded
    expect(names.length).toBeGreaterThan(0);
  } finally {
    act(() => r?.unmount());
    alert.mockRestore();
  }
});
