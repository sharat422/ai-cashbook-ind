/**
 * Accountant read-only access, app side: the role can't reach any screen that
 * writes, every request names one business, a revoked user is signed out on
 * the very next response, and the owner's activity log shows IST times.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {readFileSync} from 'fs';
import {join} from 'path';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {ApiError, apiRequest} from '@api/client';
import {PERMISSIONS, roleCan} from '@features/auth/rbac';
import {withPermission} from '@navigation/withPermission';
import {useAuthStore} from '@store/auth.store';
import {AccountantActivityScreen} from './presentation/screens/AccountantActivityScreen';

jest.setTimeout(30_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
// The loading shimmer's animation timer would outlive the test.
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
const mockActivity = jest.fn();
jest.mock('@features/team/data/team.remote', () => ({
  teamRemote: {activity: (...a: unknown[]) => mockActivity(...a)},
}));

const strings = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join(''));

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    preferredLanguage: 'en', token: 'tok', notice: null,
    business: {id: 'biz-A', businessName: 'A Traders', role: 'accountant'} as any,
  });
});

it('the accountant role is read-only', () => {
  for (const p of [PERMISSIONS.DATA_VIEW, PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EXPORT]) {
    expect(roleCan('accountant', p)).toBe(true);
  }
  for (const p of [PERMISSIONS.ENTRY_CREATE, PERMISSIONS.ENTRY_EDIT, PERMISSIONS.ENTRY_DELETE,
    PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.TEAM_MANAGE, PERMISSIONS.BEATS_MANAGE]) {
    expect(roleCan('accountant', p)).toBe(false);
  }
});

it('a write screen shows "read-only" to an accountant, and works for the owner', () => {
  const Form = () => <Text>THE FORM</Text>;
  const Guarded = withPermission(Form, PERMISSIONS.ENTRY_EDIT);
  const nav = {goBack: jest.fn()};
  let r!: ReactTestRenderer;
  act(() => { r = create(<Guarded navigation={nav} />); });
  expect(strings(r)).not.toContain('THE FORM');
  expect(r.root.findAllByProps({testID: 'read-only-screen'}).length).toBeGreaterThan(0);
  act(() => { useAuthStore.setState({business: {id: 'biz-A', role: 'owner'} as any}); });
  expect(strings(r)).toContain('THE FORM');
  act(() => r.unmount());
});

it('every screen that writes is wrapped in the guard', () => {
  const src = readFileSync(join(__dirname, '../../navigation/AppNavigator.tsx'), 'utf8');
  const WRITE = ['AITransaction', 'QuickAdd', 'AddIncome', 'AddExpense', 'ReceiptCapture', 'ReceiptReview',
    'AddCredit', 'CustomerForm', 'Bill', 'RequestPayment', 'CollectionAssistant', 'CashCounter', 'Categorize',
    'StockCount', 'KhataImport', 'BusinessEdit', 'ItemForm', 'RecurringForm', 'SchemeForm', 'Team', 'BeatPlan',
    'AccountantActivity'];
  for (const name of WRITE) {
    expect(src).toMatch(new RegExp(`name="${name}"\\s+component=\\{Guarded\\.`));
  }
});

describe('the API client', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('names the business on every request', async () => {
    const fetchMock = jest.fn(async () => ({ok: true, status: 200, text: async () => '{}'}));
    global.fetch = fetchMock as unknown as typeof fetch;
    await apiRequest('/customers');
    const headers = (fetchMock.mock.calls[0] as unknown as [string, {headers: Record<string, string>}])[1].headers;
    expect(headers['X-Business-Id']).toBe('biz-A');
  });

  it('signs out at once when the owner has revoked access', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false, status: 403,
      headers: {get: (h: string) => (h.toLowerCase() === 'x-bolcash-access' ? 'revoked' : null)},
      text: async () => JSON.stringify({detail: 'The owner has removed your access to this business.'}),
    })) as unknown as typeof fetch;
    await expect(apiRequest('/customers')).rejects.toBeInstanceOf(ApiError);
    const s = useAuthStore.getState();
    expect([s.token, s.business, s.notice]).toEqual([null, null, 'accessRevoked']);
  });

  it('an ordinary "not allowed" does not sign anyone out', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false, status: 403, headers: {get: () => null}, text: async () => '{"detail":"no"}',
    })) as unknown as typeof fetch;
    await expect(apiRequest('/team')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().token).toBe('tok');
  });
});

it("the owner's log shows what was viewed and exported, in IST", async () => {
  useAuthStore.setState({business: {id: 'biz-A', role: 'owner'} as any});
  mockActivity.mockResolvedValue([
    {at: '2026-11-07T08:35:00+00:00', atIst: '07 Nov 2026, 02:05 PM IST', mobile: '7311000005', userId: 'u1',
      action: 'export', area: 'reports', customer: null, path: '/api/v1/reports/tally-export.csv'},
    {at: '2026-11-06T20:00:00+00:00', atIst: '07 Nov 2026, 01:30 AM IST', mobile: '7311000005', userId: 'u1',
      action: 'view', area: 'ledger', customer: 'Ramesh Kirana', path: '/api/v1/customers/x/ledger'},
  ]);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}})}>
        <AccountantActivityScreen navigation={{} as any} route={{params: {userId: 'u1', mobile: '7311000005'}} as any} />
      </QueryClientProvider>,
    );
  });
  // React Query delivers results on a timer; wait for the rows.
  for (let i = 0; i < 50 && !r.root.findAllByProps({testID: 'audit-row'}).length; i++) {
    await act(async () => { await new Promise(res => setTimeout(res, 10)); });
  }
  const text = strings(r).join('\n');
  act(() => r.unmount());
  expect(mockActivity).toHaveBeenCalledWith('u1');
  expect(text).toContain('Exported · reports');
  expect(text).toContain('Viewed · customer ledger · Ramesh Kirana');
  expect(text).toContain('07 Nov 2026, 14:05 IST'); // 08:35 UTC
  expect(text).toContain('07 Nov 2026, 01:30 IST'); // past midnight in India, still the 6th in UTC
});
