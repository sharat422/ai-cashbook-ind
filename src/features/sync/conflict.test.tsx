/**
 * Acceptance: when the same customer was changed on two devices, the app
 * shows both versions and waits for the owner's choice — nothing is
 * overwritten silently, by the online save or by the offline queue.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {ApiError, NetworkError} from '@api/client';
import type {Customer, CustomerDraft} from '@features/customers/domain/entities';
import {useAuthStore} from '@store/auth.store';
import {saveCustomerEdit, syncCustomerEdits, useCustomerEdits} from './customerEdits';
import {SyncConflictScreen} from './presentation/SyncConflictScreen';

jest.setTimeout(30_000); // first render loads the whole screen tree

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
const mockUpdate = jest.fn();
const mockGet = jest.fn();
jest.mock('@features/customers/di', () => ({
  customerUseCases: {update: (...a: unknown[]) => mockUpdate(...a), get: (...a: unknown[]) => mockGet(...a)},
}));

const mine: CustomerDraft = {fullName: 'Ramesh Kirana', mobile: '9876543210', address: 'Main Road, Guntur'};
const theirs: Customer = {
  id: 'c1', fullName: 'Ramesh Kirana & Sons', mobile: '9876543210', address: 'Old Market, Guntur',
  outstandingAmount: 0, isOverdue: false, createdAt: '2026-10-01T00:00:00Z', version: 3,
};
const conflict409 = () => new ApiError(409, 'changed on another device');

const nav = {navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn()} as any;
const route = {params: {customerId: 'c1'}} as any;

function renderScreen(): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}})}>
        <SyncConflictScreen navigation={nav} route={route} />
      </QueryClientProvider>,
    );
  });
  return r;
}
const text = (r: ReactTestRenderer, id: string) =>
  ([] as unknown[]).concat(r.root.findByProps({testID: id}).findByType(Text).props.children).join('');
const buttons = (r: ReactTestRenderer) =>
  [...new Set(r.root.findAll(n => n.props.testID === 'keep-mine' || n.props.testID === 'keep-theirs').map(n => n.props.testID))];

beforeEach(() => {
  jest.clearAllMocks();
  useCustomerEdits.setState({pending: [], conflicts: []});
  useAuthStore.setState({preferredLanguage: 'en', business: {id: 'b1', role: 'owner'} as any});
  mockGet.mockResolvedValue(theirs);
});

it('a stale online save is parked as a conflict, not written', async () => {
  mockUpdate.mockRejectedValueOnce(conflict409());
  expect(await saveCustomerEdit('c1', mine, 1)).toBe('conflict');
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockUpdate).toHaveBeenCalledWith('c1', mine, 1); // only ever with the version token
  expect(useCustomerEdits.getState().conflicts).toEqual([
    expect.objectContaining({customerId: 'c1', mine, theirs}),
  ]);

  // Syncing never settles it on its own.
  await syncCustomerEdits();
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(useCustomerEdits.getState().conflicts).toHaveLength(1);
});

it('two phones offline: the queued edit meets the other one at sync and waits for the owner', async () => {
  mockUpdate.mockRejectedValueOnce(new NetworkError());
  expect(await saveCustomerEdit('c1', mine, 1)).toBe('queued');
  mockUpdate.mockRejectedValueOnce(conflict409());
  await syncCustomerEdits();
  expect(useCustomerEdits.getState().pending).toEqual([]);
  expect(useCustomerEdits.getState().conflicts.map(c => c.mine)).toEqual([mine]);
});

it('a lost reply to our own save is not a conflict', async () => {
  mockUpdate.mockRejectedValueOnce(conflict409());
  mockGet.mockResolvedValueOnce({...theirs, ...mine, gstNumber: undefined, businessName: undefined, notes: undefined});
  expect(await saveCustomerEdit('c1', mine, 1)).toBe('saved');
  expect(useCustomerEdits.getState().conflicts).toEqual([]);
});

describe('the conflict screen', () => {
  beforeEach(async () => {
    mockUpdate.mockRejectedValueOnce(conflict409());
    await saveCustomerEdit('c1', mine, 1);
  });

  it('shows both versions and marks what differs', () => {
    const r = renderScreen();
    expect(text(r, 'mine-fullName')).toBe('Ramesh Kirana');
    expect(text(r, 'theirs-fullName')).toBe('Ramesh Kirana & Sons');
    expect(text(r, 'mine-address')).toBe('Main Road, Guntur');
    expect(text(r, 'theirs-address')).toBe('Old Market, Guntur');
    const rows = (f: string) => r.root.findByProps({testID: `conflict-row-${f}`}).props.className;
    expect(rows('fullName')).toContain('violet');
    expect(rows('mobile')).not.toContain('violet');
    expect(buttons(r)).toHaveLength(2);
    expect(mockUpdate).toHaveBeenCalledTimes(1); // showing it saves nothing
  });

  it("keep the other device's version: nothing is sent", async () => {
    const r = renderScreen();
    await act(async () => { await r.root.findByProps({testID: 'keep-theirs'}).props.onPress(); });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(useCustomerEdits.getState().conflicts).toEqual([]);
    expect(nav.goBack).toHaveBeenCalled();
  });

  it("keep this phone's version: saved over the version the owner was shown", async () => {
    mockUpdate.mockResolvedValueOnce({...theirs, ...mine, version: 4});
    const r = renderScreen();
    await act(async () => { await r.root.findByProps({testID: 'keep-mine'}).props.onPress(); });
    expect(mockUpdate).toHaveBeenLastCalledWith('c1', mine, 3);
    expect(useCustomerEdits.getState().conflicts).toEqual([]);
  });

  it('if it changed again meanwhile, the owner sees the newest version and chooses again', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockUpdate.mockRejectedValueOnce(conflict409());
    mockGet.mockResolvedValueOnce({...theirs, fullName: 'Ramesh Stores', version: 5});
    const r = renderScreen();
    await act(async () => { await r.root.findByProps({testID: 'keep-mine'}).props.onPress(); });
    expect(alert).toHaveBeenCalled();
    expect(useCustomerEdits.getState().conflicts[0].theirs.version).toBe(5);
    expect(text(r, 'theirs-fullName')).toBe('Ramesh Stores');
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it('staff cannot choose', () => {
    useAuthStore.setState({business: {id: 'b1', role: 'staff'} as any});
    expect(buttons(renderScreen())).toHaveLength(0);
  });
});
