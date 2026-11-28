/**
 * The owner sets the UPI ID once in Settings → Payments: it's saved on the business
 * (PATCH /businesses/me), not on this phone, so every member's phone uses it. A UPI
 * ID this phone kept from before is offered, so it moves to the business in one save.
 */
import React from 'react';
import {Alert, TextInput} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {useAuthStore} from '@store/auth.store';
import {SettingsScreen} from './SettingsScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/auth/components/BusinessSwitcher', () => ({BusinessSwitcher: () => null}));
jest.mock('@features/team/presentation/JoinInviteCard', () => ({JoinInviteCard: () => null}));
jest.mock('@features/schemes/presentation/BillPrefixCard', () => ({BillPrefixCard: () => null}));
jest.mock('@features/customers/presentation/components/StatementLanguageSetting', () => ({
  StatementLanguageSetting: () => null,
}));
jest.mock('@features/security/store/appLock.store', () => ({
  PIN_LENGTH: 4,
  getSupportedBiometry: () => Promise.resolve(null),
  useAppLockStore: (pick: (s: object) => unknown) => pick({enabled: false, biometricEnabled: false}),
}));
const mockUpdate = jest.fn();
jest.mock('@features/account/data/account.remote', () => ({
  accountRemote: {updateBusiness: (...a: unknown[]) => mockUpdate(...a)},
}));

const field = (r: ReactTestRenderer, placeholder: string) =>
  r.root.findAllByType(TextInput).find(n => n.props.placeholder === placeholder)!;

test('saved on the business, the phone keeps no copy, and the role stays', async () => {
  useAuthStore.setState({business: {id: 'b1', businessName: 'Gupta Traders', role: 'owner'} as never});
  useCollectionSettingsStore.setState({upiId: 'old@okicici', payeeName: 'Gupta'}); // set before the move
  mockUpdate.mockResolvedValue({id: 'b1', businessName: 'Gupta Traders', upiId: 'shop@okhdfcbank', upiPayeeName: 'Gupta'});
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => {});
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<SettingsScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />); });

  expect(field(r, 'e.g. shop@okhdfcbank').props.value).toBe('old@okicici'); // offered, to save once for everyone
  await act(async () => field(r, 'e.g. shop@okhdfcbank').props.onChangeText('shop@okhdfcbank'));
  await act(async () => r.root.findAll(n => n.props.testID === 'upi-save' && n.props.onPress)[0].props.onPress());

  expect(mockUpdate).toHaveBeenCalledWith({upiId: 'shop@okhdfcbank', upiPayeeName: 'Gupta'});
  expect(useAuthStore.getState().business).toMatchObject({upiId: 'shop@okhdfcbank', role: 'owner'});
  expect(useCollectionSettingsStore.getState().upiId).toBe('');
  expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Saved');

  // A malformed one never reaches the server.
  mockUpdate.mockClear();
  await act(async () => field(r, 'e.g. shop@okhdfcbank').props.onChangeText('shop@'));
  await act(async () => r.root.findAll(n => n.props.testID === 'upi-save' && n.props.onPress)[0].props.onPress());
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('UPI ID not valid', 'Use the form name@bank, e.g. shop@okhdfcbank.');
  act(() => r.unmount());
});
