/** ST4 on the statement screen: a live link offers "Revoke link" (after a
 *  confirm); a revoked one shows "Revoked" with the date and no button. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {StatementLinksCard} from './StatementLinksCard';

jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => true})}));
const mockRevoke = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('@features/customers/data/statements.remote', () => ({
  statementsRemote: {
    links: async () => [
      {id: 'L2', createdAt: '2026-11-10T05:00:00Z', expiresAt: '2026-12-10T05:00:00Z', revokedAt: null,
        periodFrom: null, status: 'live', limitedAt: '2026-11-11T06:00:00Z'},
      {id: 'L1', createdAt: '2026-11-01T05:00:00Z', expiresAt: '2026-12-01T05:00:00Z',
        revokedAt: '2026-11-05T05:00:00Z', periodFrom: null, status: 'revoked'},
    ],
    revokeLink: (...a: unknown[]) => mockRevoke(...a),
  },
}));

const textIn = (r: ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id)[0].findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children).join(' ');

test('a live link can be revoked after confirming; a revoked one says when', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient()}>
        <StatementLinksCard customer={{id: 'c1', fullName: 'Ravi Stores'} as never} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  expect(textIn(r, 'link-L1')).toContain('Revoked');
  expect(textIn(r, 'limited-L2')).toContain('Opened too often');  // ST8: the owner sees limit hits
  expect(r.root.findAll(n => n.props.testID === 'revoke-L1')).toEqual([]);  // no un-revoke
  await act(async () => { r.root.findAll(n => n.props.testID === 'revoke-L2' && n.props.onPress)[0].props.onPress(); });
  expect(mockRevoke).not.toHaveBeenCalled();  // asks first
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  await act(async () => { buttons.find((b: {style?: string}) => b.style === 'destructive').onPress(); });
  expect(mockRevoke).toHaveBeenCalledWith('L2');
  act(() => r.unmount());
});
