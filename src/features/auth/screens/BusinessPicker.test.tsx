/**
 * AC3 in the app: after login, more than one business → the picker (business,
 * owner, last opened), the one last chosen on this phone first; picking opens
 * it and is remembered. One business → straight in, as before.
 */
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {getMyBusiness, listMyBusinesses, openBusiness, type BusinessChoice} from '@api/auth.api';
import {useSyncBusiness} from '@features/auth/hooks/useSyncBusiness';
import {useLastBusiness} from '@features/auth/store/lastBusiness.store';
import {useAuthStore} from '@store/auth.store';
import {BusinessPickerScreen} from './BusinessPickerScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@api/auth.api', () => ({
  ...jest.requireActual('@api/auth.api'),
  listMyBusinesses: jest.fn(), getMyBusiness: jest.fn(), openBusiness: jest.fn(),
}));

const three: BusinessChoice[] = [
  {id: 'a', businessName: 'Anil Traders', ownerName: 'Anil', role: 'accountant', lastOpenedAt: null},
  {id: 'b', businessName: 'Balaji Traders', ownerName: 'Balaji', role: 'accountant', lastOpenedAt: '2026-11-10T05:00:00+00:00'},
  {id: 'c', businessName: 'Chandra Traders', ownerName: 'Chandra', role: 'accountant', lastOpenedAt: null},
];
const Sync = () => { useSyncBusiness(); return null; };
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)); });
};
const names = (r: ReactTestRenderer) => r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join(''))
  .filter(s => s.endsWith('Traders'));

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({token: null, user: null, business: null, businessChoices: null});
  useLastBusiness.setState({byUser: {}});
});

test('three businesses: the picker, last choice on this phone first; picking opens and remembers it', async () => {
  (listMyBusinesses as jest.Mock).mockResolvedValue(three);
  (openBusiness as jest.Mock).mockResolvedValue({id: 'c', businessName: 'Chandra Traders'});
  useLastBusiness.setState({byUser: {u1: 'c'}});
  let sync!: ReactTestRenderer;
  await act(async () => {
    useAuthStore.setState({token: 't', user: {id: 'u1', mobile: '9'} as never});
    sync = create(<Sync />);
  });
  await settle();
  expect(useAuthStore.getState().status()).toBe('choosing-business');
  expect(getMyBusiness).not.toHaveBeenCalled();                 // not the first business by default

  let r!: ReactTestRenderer;
  await act(async () => { r = create(<BusinessPickerScreen />); });
  expect(names(r)).toEqual(['Chandra Traders', 'Anil Traders', 'Balaji Traders']);
  const shown = r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join('\n');
  expect(shown).toContain('Owner: Balaji');
  expect(shown).toContain('Last opened on this phone');
  await act(async () => { r.root.findAll(n => n.props.testID === 'pick-b' && n.props.onPress)[0].props.onPress(); });
  await settle();
  expect(openBusiness).toHaveBeenCalledWith('b');
  expect(useAuthStore.getState().status()).toBe('authenticated');
  expect(useLastBusiness.getState().byUser.u1).toBe('b');
  act(() => { r.unmount(); sync.unmount(); });
});

test('one business: straight in, no picker', async () => {
  (listMyBusinesses as jest.Mock).mockResolvedValue([three[0]]);
  (getMyBusiness as jest.Mock).mockResolvedValue({id: 'a', businessName: 'Anil Traders'});
  let sync!: ReactTestRenderer;
  await act(async () => {
    useAuthStore.setState({token: 't2', user: {id: 'u2', mobile: '8'} as never});
    sync = create(<Sync />);
  });
  await settle();
  expect(getMyBusiness).toHaveBeenCalled();
  expect(useAuthStore.getState().status()).toBe('authenticated');
  act(() => sync.unmount());
});
