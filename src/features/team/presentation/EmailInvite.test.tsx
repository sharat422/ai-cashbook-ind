/**
 * AC2 in the app: the Team screen invites by mobile or by email and lists the
 * invites (expired ones say so, with Resend); someone invited by email joins by
 * pasting the link or opening bolcash://invite/<token>, after signing in.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Linking, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {apiRequest} from '@api/client';
import {openBusiness} from '@api/auth.api';
import {useAuthStore} from '@store/auth.store';
import {inviteToken, type TeamInviteEntry} from '../data/invites';
import {JoinInviteCard} from './JoinInviteCard';
import {TeamScreen} from './screens/TeamScreen';
import {useInviteDeepLink} from './useInviteDeepLink';

jest.setTimeout(90_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@api/client', () => ({...jest.requireActual('@api/client'), apiRequest: jest.fn()}));
jest.mock('@api/auth.api', () => ({...jest.requireActual('@api/auth.api'), openBusiness: jest.fn()}));
jest.mock('@features/team/presentation/hooks', () => ({
  useTeam: () => ({data: [], isLoading: false, refetch: jest.fn(), isRefetching: false}),
  useTeamMutations: () => {
    const m = {mutate: jest.fn(), isPending: false};
    return {add: m, updateRole: m, remove: m, rename: m};
  },
}));

const TOKEN = `${'a'.repeat(32)}.1795000000.${'b'.repeat(32)}`;
const invite = (over: Partial<TeamInviteEntry>): TeamInviteEntry => ({
  id: 'i1', channel: 'email', to: 'ca@example.com', role: 'accountant', name: null, sentBy: 'owner · 98',
  sentAt: '2026-11-01T10:00:00+00:00', expiresAt: '2026-11-08T10:00:00+00:00', acceptedAt: null,
  status: 'pending', ...over,
});
const api = apiRequest as jest.Mock;
const text = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join('\n');
const byId = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && (n.props.onPress || n.props.onChangeText));
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)); });
};
const wrap = (el: React.ReactElement) =>
  <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>;

beforeEach(() => {
  api.mockReset();
  (openBusiness as jest.Mock).mockResolvedValue({id: 'biz-1', businessName: 'Sri Lakshmi Agencies'});
});

test('an invite link is read from the email page, the app link or the bare token', () => {
  expect(inviteToken(`https://api.example.com/invite/${TOKEN}`)).toBe(TOKEN);
  expect(inviteToken(`bolcash://invite/${TOKEN}`)).toBe(TOKEN);
  expect(inviteToken(` ${TOKEN} `)).toBe(TOKEN);
  expect(inviteToken('https://example.com/something-else')).toBeNull();
});

test('the Team screen sends an email invite and lists invites, expired ones with Resend', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  api.mockImplementation(async (path: string) => (path === '/team/invites'
    ? [invite({id: 'p', status: 'pending'}), invite({id: 'x', status: 'expired'}),
      invite({id: 'ph', channel: 'phone', to: '9876543210', status: 'accepted'})]
    : invite({})));
  let r!: ReactTestRenderer;
  await act(async () => { r = create(wrap(<TeamScreen navigation={{navigate: jest.fn()} as any} route={{} as any} />)); });
  await settle();
  const shown = text(r);
  expect(shown).toContain('Expired: not accepted within 7 days');
  expect(shown).toContain('Waiting · link valid until');
  expect(byId(r, 'invite-resend-x').length).toBeGreaterThan(0);
  expect(byId(r, 'invite-resend-ph')).toHaveLength(0);                      // a phone invite needs no link
  await act(async () => { byId(r, 'team-contact')[0].props.onChangeText('ca@example.com'); });
  await act(async () => { byId(r, 'team-add')[0].props.onPress(); });
  await settle();
  expect(api).toHaveBeenCalledWith('/team/invites/email', {method: 'POST',
    body: {email: 'ca@example.com', role: 'staff', name: undefined}});
  expect(alert).toHaveBeenCalledWith('Invite sent', 'We emailed ca@example.com a link. It works once, for 7 days.');
  await act(async () => { byId(r, 'invite-resend-x')[0].props.onPress(); });
  await settle();
  expect(api).toHaveBeenCalledWith('/team/invites/x/resend', {method: 'POST'});
  alert.mockRestore();
  act(() => r.unmount());
});

test('pasting the link joins the business (the same membership) and opens it', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  api.mockResolvedValue({businessId: 'biz-1', businessName: 'Sri Lakshmi Agencies', role: 'accountant'});
  let r!: ReactTestRenderer;
  await act(async () => { r = create(wrap(<JoinInviteCard />)); });
  await act(async () => { byId(r, 'invite-link')[0].props.onChangeText(`https://api.example.com/invite/${TOKEN}`); });
  await act(async () => { byId(r, 'invite-join')[0].props.onPress(); });
  await settle();
  expect(api).toHaveBeenCalledWith('/team/invites/accept', {method: 'POST', body: {token: TOKEN}});
  expect(openBusiness).toHaveBeenCalledWith('biz-1');
  expect(useAuthStore.getState().business).toMatchObject({id: 'biz-1'});
  expect(alert).toHaveBeenCalledWith("You've joined Sri Lakshmi Agencies.");
  alert.mockRestore();
  act(() => r.unmount());
});

test('bolcash://invite/<token> opened before login is accepted once signed in', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`bolcash://invite/${TOKEN}`);
  api.mockResolvedValue({businessId: 'biz-1', businessName: 'Sri Lakshmi Agencies', role: 'accountant'});
  useAuthStore.setState({token: null});
  const Probe = () => { useInviteDeepLink(); return null; };
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<Probe />); });
  await settle();
  expect(api).not.toHaveBeenCalled();                                         // waits for login
  await act(async () => { useAuthStore.setState({token: 'signed-in'}); });
  await settle();
  expect(api).toHaveBeenCalledWith('/team/invites/accept', {method: 'POST', body: {token: TOKEN}});
  expect(api).toHaveBeenCalledTimes(1);
  alert.mockRestore();
  act(() => r.unmount());
});
