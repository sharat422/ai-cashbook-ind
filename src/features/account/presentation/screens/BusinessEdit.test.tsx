/**
 * Business settings: a GST business enters its address, which is printed on
 * its GST invoices; it is saved with the GSTIN (trimmed).
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useAuthStore} from '@store/auth.store';
import {BusinessEditScreen} from './BusinessEditScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
const mockUpdate = jest.fn(async (patch: object) => ({...patch}));
jest.mock('@features/account/data/account.remote', () => ({
  accountRemote: {updateBusiness: (patch: object) => mockUpdate(patch)},
}));

const byId = (r: ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.props.onChangeText === 'function');

test('the address is saved with the GSTIN, and only a GST business is asked for it', async () => {
  useAuthStore.setState({business: {id: 'b1', businessName: 'Test Traders', ownerName: 'Ravi', businessType: 'Retail',
    state: 'Karnataka', gstRegistered: true, gstin: '29AAACS1234B1ZW'}} as never);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<BusinessEditScreen navigation={{goBack: jest.fn()} as never} route={{} as never} />);
  });
  await act(async () => byId(r, 'business-address')[0].props.onChangeText('  14 Market Road, Mysuru 570001 '));
  const save = r.root.findAll(n => typeof n.props.onPress === 'function' && n.props.title === 'Save')[0];
  await act(async () => save.props.onPress());
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    address: '14 Market Road, Mysuru 570001', gstin: '29AAACS1234B1ZW'}));
  act(() => r.unmount());

  useAuthStore.setState({business: {id: 'b2', businessName: 'Small Shop', ownerName: 'Sita', businessType: 'Retail',
    state: 'Karnataka', gstRegistered: false}} as never);
  await act(async () => {
    r = create(<BusinessEditScreen navigation={{goBack: jest.fn()} as never} route={{} as never} />);
  });
  expect(byId(r, 'business-address')).toHaveLength(0);
  act(() => r.unmount());
});
