/**
 * Scheme claims on the phone: File claim next to each scheme in the Scheme report
 * (after a confirm) makes the claim from that month's log; the claims list shows
 * its status and value; the owner sets the status and the supplier's answer, and
 * anyone who sees reports can send the PDF or Excel.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {SchemeClaim} from '@features/schemes/data/schemes.remote';
import {useAuthStore} from '@store/auth.store';
import {SchemeClaimsScreen} from './SchemeClaimsScreen';
import {SchemeReportScreen} from './SchemeReportScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
const mockShare = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@api/download', () => ({downloadAndShare: (...a: unknown[]) => mockShare(...a)}));
const mockFile = jest.fn();
const mockUpdate = jest.fn();
let mockClaims: SchemeClaim[] = [];
jest.mock('@features/schemes/data/schemes.remote', () => ({
  CLAIM_STATUSES: ['draft', 'filed', 'approved', 'rejected', 'paid'],
  schemesRemote: {
    report: async () => ({from: '2026-11-01', to: '2026-11-30', totalDiscount: '40.00', totalValue: '190.00', totalFreeQty: '6.000',
      rows: [
        {schemeId: 's1', schemeName: 'Soap 10+1', schemeType: 'buy_get', itemId: 'soap', itemName: 'Soap', bills: 3,
          quantity: '60.000', freeQty: '6.000', discount: '0.00', value: '150.00'},
        {schemeId: 's2', schemeName: 'Oil 5%', schemeType: 'percent', itemId: 'oil', itemName: 'Oil', bills: 3,
          quantity: '6.000', freeQty: '0.000', discount: '40.00', value: '40.00'},
      ]}),
    log: async () => [],
    claims: async () => mockClaims,
    fileClaim: (...a: unknown[]) => mockFile(...a),
    updateClaim: (...a: unknown[]) => mockUpdate(...a),
  },
}));

const claim: SchemeClaim = {id: 'c1', schemeId: 's1', schemeName: 'Soap 10+1', schemeType: 'buy_get', from: '2026-11-01',
  to: '2026-11-30', status: 'draft', bills: 3, quantity: '60.000', freeQty: '6.000', discount: '0.00', value: '150.00',
  lines: [{itemId: 'soap', itemName: 'Soap', bills: 3, quantity: '60.000', freeQty: '6.000', discount: '0.00', value: '150.00'}],
  note: null, createdAt: 'x', filedAt: null};

async function mount(el: React.ReactElement, role = 'owner') {
  useAuthStore.setState({business: {id: 'b1', businessName: 'Gupta Traders', role}} as never);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>);
  });
  await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  return r;
}
const byId = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && n.props.onPress);
const texts = (r: ReactTestRenderer) => r.root.findAll(n => (n.type as unknown) === 'Text')
  .map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' | ');

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => {});
  mockFile.mockReset().mockResolvedValue(claim);
  mockUpdate.mockReset().mockResolvedValue(claim);
  mockShare.mockClear();
});

test('the report: File claim for a scheme makes it from the month, then opens the claims', async () => {
  const navigate = jest.fn();
  const r = await mount(<SchemeReportScreen navigation={{navigate} as never} route={{params: undefined} as never} />);
  expect(byId(r, 'claim-file-s1')).not.toHaveLength(0);
  expect(byId(r, 'claim-file-s2')).not.toHaveLength(0);
  await act(async () => byId(r, 'claim-file-s1')[0].props.onPress());
  const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('File a claim for Soap 10+1?');
  expect(message).toContain('₹150.00');
  expect(mockFile).not.toHaveBeenCalled(); // asks first
  await act(async () => buttons[1].onPress());
  expect(mockFile).toHaveBeenCalledWith('s1', expect.stringMatching(/^\d{4}-\d{2}-01$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  expect(navigate).toHaveBeenCalledWith('SchemeClaims');
  act(() => r.unmount());
});

test('an accountant sees the report and claims but files nothing', async () => {
  const r = await mount(<SchemeReportScreen navigation={{navigate: jest.fn()} as never} route={{params: undefined} as never} />,
    'accountant');
  expect(byId(r, 'claim-file-s1')).toHaveLength(0);
  act(() => r.unmount());
});

test('the claims list: status and value; the owner marks it filed with the answer and sends the PDF', async () => {
  mockClaims = [claim];
  const r = await mount(<SchemeClaimsScreen />);
  expect(texts(r)).toContain('Soap 10+1');
  expect(texts(r)).toContain('Draft');
  await act(async () => byId(r, 'claim-c1')[0].props.onPress());
  expect(texts(r)).toContain('₹150.00');
  await act(async () => r.root.findAll(n => n.props.label === 'Filed' && n.props.onPress)[0].props.onPress());
  await act(async () => r.root.findAll(n => n.props.testID === 'claim-note' && n.props.onChangeText)[0]
    .props.onChangeText('HUL ref CL-778'));
  await act(async () => byId(r, 'claim-save')[0].props.onPress());
  expect(mockUpdate).toHaveBeenCalledWith('c1', {status: 'filed', note: 'HUL ref CL-778'});
  await act(async () => byId(r, 'claim-c1')[0].props.onPress());
  await act(async () => byId(r, 'claim-pdf')[0].props.onPress());
  expect(mockShare).toHaveBeenCalledWith('/schemes/claims/c1.pdf', 'Claim_Soap_10_1_2026-11-01_2026-11-30.pdf', 'application/pdf');
  act(() => r.unmount());
});
