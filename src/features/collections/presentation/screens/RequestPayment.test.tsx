/**
 * Request Payment builds its QR from the business's UPI ID, so a staff phone that
 * never had one set still makes a working QR. Only when the business has none is
 * a UPI ID this phone kept from before used, with a warning.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {useAuthStore} from '@store/auth.store';
import {RequestPaymentScreen} from './RequestPaymentScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
const mockServer = jest.fn();
jest.mock('@api/auth.api', () => ({getMyBusiness: () => mockServer()}));
jest.mock('@features/customers/presentation/hooks', () => ({
  useLedgerMutations: () => ({receivePayment: {mutate: jest.fn(), isPending: false}}),
}));

const customer = {id: 'c1', fullName: 'Ramesh', mobile: '9876543210', outstandingAmount: 1500};

/** business: the server's (and, unless `cached` says otherwise, the phone's copy too).
 *  server: an Error for no connection. */
async function render(role: 'owner' | 'staff', business: object, phone = {upiId: '', payeeName: ''},
  {cached = business, server}: {cached?: object; server?: object | Error} = {}) {
  const biz = (b: object) => ({id: 'b1', businessName: 'Gupta Traders', role, ...b});
  useAuthStore.setState({business: biz(cached) as never});
  useCollectionSettingsStore.setState(phone);
  const reply = server ?? business;
  mockServer.mockReset().mockImplementation(() => reply instanceof Error ? Promise.reject(reply) : Promise.resolve(biz(reply)));
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={client}>
      <RequestPaymentScreen navigation={{navigate: jest.fn(), goBack: jest.fn()} as never}
        route={{params: {customer}} as never} />
    </QueryClientProvider>);
  });
  await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  const qr = r.root.findAll(n => (n.type as unknown) === 'QRCode')[0];
  const has = (id: string) => r.root.findAll(n => n.props.testID === id).length > 0;
  return {r, qr: qr?.props.value as string | undefined, has};
}

test("a staff phone with nothing set uses the business's UPI ID", async () => {
  const {r, qr, has} = await render('staff', {upiId: 'shop@okhdfcbank', upiPayeeName: 'Gupta & Sons'});
  expect(qr).toContain('pa=shop%40okhdfcbank');
  expect(qr).toContain('pn=Gupta%20%26%20Sons');
  expect(qr).toContain('am=1500');
  expect(has('request-phone-upi')).toBe(false);
  act(() => r.unmount());
});

test('a phone that signed in before the owner set it gets it from the server', async () => {
  const {r, qr, has} = await render('staff', {upiId: 'shop@okhdfcbank'}, undefined, {cached: {upiId: null}});
  expect(qr).toContain('pa=shop%40okhdfcbank');
  expect(has('request-no-upi')).toBe(false);
  expect(useAuthStore.getState().business).toMatchObject({upiId: 'shop@okhdfcbank', role: 'staff'}); // the copy is updated
  act(() => r.unmount());
});

test('offline: the copy on the phone is used', async () => {
  const {r, qr} = await render('staff', {upiId: 'shop@okhdfcbank'}, undefined, {server: new Error('No internet connection.')});
  expect(qr).toContain('pa=shop%40okhdfcbank');
  act(() => r.unmount());
});

test("the business's UPI ID wins over one this phone kept from before", async () => {
  const {r, qr} = await render('owner', {upiId: 'shop@okhdfcbank'}, {upiId: 'old@okicici', payeeName: 'Old'});
  expect(qr).toContain('pa=shop%40okhdfcbank');
  expect(qr).toContain('pn=Gupta%20Traders'); // no payee name set: the business name
  act(() => r.unmount());
});

test("the business has none: this phone's old UPI ID, with a warning", async () => {
  const {r, qr, has} = await render('staff', {upiId: null}, {upiId: 'old@okicici', payeeName: 'Old'});
  expect(qr).toContain('pa=old%40okicici');
  expect(has('request-phone-upi')).toBe(true);
  act(() => r.unmount());
});

test('none anywhere: no QR; staff are told to ask the owner, the owner gets the Settings button', async () => {
  let {r, qr, has} = await render('staff', {upiId: null});
  expect(qr).toBeUndefined();
  expect(has('request-no-upi')).toBe(true);
  expect(JSON.stringify(r.toJSON())).toContain('Ask the owner to set it in Settings');
  expect(JSON.stringify(r.toJSON())).not.toContain('Set UPI ID in Settings');
  act(() => r.unmount());
  ({r} = await render('owner', {upiId: null}));
  expect(JSON.stringify(r.toJSON())).toContain('Set UPI ID in Settings');
  act(() => r.unmount());
});
