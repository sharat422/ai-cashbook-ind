/** ST5 on the statement screen: the owner picks a retailer's statement
 *  language, or "Business default" (null), which shows what the default is. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {StatementConsentCard} from './StatementConsentCard';

jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => true})}));
const mockSetLanguage = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('@features/customers/data/statements.remote', () => ({
  statementsRemote: {
    consent: async () => ({status: 'opted_in', since: null, source: 'owner', history: [],
      language: null, defaultLanguage: 'te'}),
    setLanguage: (...a: unknown[]) => mockSetLanguage(...a),
  },
}));

test('a retailer gets their own statement language, or the business default', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient()}>
        <StatementConsentCard customer={{id: 'c1', fullName: 'Ravi Stores'} as never} />
      </QueryClientProvider>,
    );
  });
  const find = () => r.root.findAll(n => n.props.label === 'Statement language' && n.props.onSelect)[0];
  for (let i = 0; i < 50 && !find(); i++) {  // wait for the query, however busy the machine
    await act(async () => { await new Promise(res => setTimeout(res, 10)); });
  }
  const select = find();
  expect(select.props.value).toBe('default');
  expect(select.props.labelOf('default')).toBe('Business default (తెలుగు)');
  await act(async () => { select.props.onSelect('hi'); });
  expect(mockSetLanguage).toHaveBeenLastCalledWith('c1', 'hi');
  await act(async () => { select.props.onSelect('default'); });
  expect(mockSetLanguage).toHaveBeenLastCalledWith('c1', null);
  act(() => r.unmount());
});
