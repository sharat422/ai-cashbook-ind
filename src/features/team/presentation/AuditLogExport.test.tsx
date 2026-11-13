/**
 * AC4 in the app: an accountant's export shows on the owner's home screen until
 * opened; the activity screen filters by IST dates and exports the same rows.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {downloadAndShare} from '@api/download';
import {teamRemote} from '@features/team/data/team.remote';
import {ExportAlertBanner} from './ExportAlertBanner';
import {AccountantActivityScreen} from './screens/AccountantActivityScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('@api/download', () => ({downloadAndShare: jest.fn(async () => undefined)}));
let mockOwner = true;
jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => mockOwner})}));
jest.mock('@features/team/data/team.remote', () => ({
  ...jest.requireActual('@features/team/data/team.remote'),
  teamRemote: {activity: jest.fn(), exportAlerts: jest.fn(), exportAlertsSeen: jest.fn()},
}));

const remote = teamRemote as unknown as Record<string, jest.Mock>;
const wrap = (el: React.ReactElement) =>
  <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>;
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)); });
};
const text = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = true;
});

test("the owner sees the accountant's export on the home screen; opening it clears it", async () => {
  let alerts = [{id: 'a1', at: '2026-11-13T05:02:00+00:00', name: 'CA Sharma', mobile: '9876500001', what: 'tally'}];
  remote.exportAlerts.mockImplementation(async () => alerts);
  remote.exportAlertsSeen.mockImplementation(async () => { alerts = []; return {cleared: 1}; });
  const onOpen = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => { r = create(wrap(<ExportAlertBanner onOpen={onOpen} />)); });
  await settle();
  expect(text(r)).toContain('CA Sharma exported the Tally file, ');
  expect(text(r)).toContain('IST');
  await act(async () => { r.root.findAll(n => n.props.testID === 'export-alerts' && n.props.onPress)[0].props.onPress(); });
  await settle();
  expect(onOpen).toHaveBeenCalled();
  expect(remote.exportAlertsSeen).toHaveBeenCalledTimes(1);
  expect(r.root.findAll(n => n.props.testID === 'export-alerts')).toHaveLength(0);   // cleared
  act(() => r.unmount());
});

test('staff and accountants never see the alert', async () => {
  mockOwner = false;
  let r!: ReactTestRenderer;
  await act(async () => { r = create(wrap(<ExportAlertBanner onOpen={jest.fn()} />)); });
  await settle();
  expect(remote.exportAlerts).not.toHaveBeenCalled();
  expect(r.toJSON()).toBeNull();
  act(() => r.unmount());
});

test('the activity screen filters by IST dates and exports the same rows to Excel', async () => {
  remote.activity.mockResolvedValue([{at: '2026-11-01T05:00:00+00:00', atIst: '01 Nov 2026, 10:30 AM IST',
    mobile: '9876500001', name: null, userId: 'u', action: 'export', area: 'gst', customer: null, path: '/x'},
    {at: '2026-11-01T04:00:00+00:00', atIst: '01 Nov 2026, 09:30 AM IST', mobile: '9876500001', name: null,
      userId: 'u', action: 'view', area: 'assistant', customer: null, path: '/api/v1/chatbot/ask',
      detail: 'Asked: total outstanding. Used: Syntaro ₹2,500.00; 1 customer'}]);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<AccountantActivityScreen navigation={{} as any} route={{params: {}} as any} />));
  });
  await settle();
  // AC5: what the log can and can't see; AC7: an Ask AI row shows the figures it used.
  expect(text(r)).toContain('Files shared onward after downloading are not tracked.');
  expect(text(r)).toContain('Asked: total outstanding. Used: Syntaro ₹2,500.00; 1 customer');
  const dates = r.root.findAll(n => typeof n.props.onChange === 'function' && 'value' in n.props && n.props.value === '');
  await act(async () => { dates[0].props.onChange('2026-11-01'); });
  await settle();
  await act(async () => { r.root.findAll(n => n.props.onChange && n.props.value === '')[0].props.onChange('2026-11-30'); });
  await settle();
  expect(remote.activity).toHaveBeenLastCalledWith(undefined, '2026-11-01', '2026-11-30');
  await act(async () => { r.root.findAll(n => n.props.testID === 'audit-export' && n.props.onPress)[0].props.onPress(); });
  await settle();
  expect(downloadAndShare).toHaveBeenCalledWith('/team/activity.xlsx?from=2026-11-01&to=2026-11-30',
    'accountant_activity_2026-11-01_2026-11-30.xlsx', expect.stringContaining('spreadsheetml'));
  act(() => r.unmount());
});
