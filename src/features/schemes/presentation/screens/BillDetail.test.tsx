/** SC5 on the phone: a saved bill offers Cancel / Return lines to the owner
 *  (after confirming), and shows a cancelled bill as cancelled. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {BillDetailScreen} from './BillDetailScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
let mockOwner = true;
jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => mockOwner})}));
let mockStatus: string | null = null;
const mockCancel = jest.fn(async () => ({}));
jest.mock('@features/schemes/data/schemes.remote', () => ({
  schemesRemote: {
    getBill: async () => ({
      id: 'b1', billNumber: 'B-3', customerId: 'c', date: '2026-11-11', subtotal: '700.00', discount: '0.00',
      total: '700.00', ledgerEntryId: 'e', schemes: [], status: mockStatus, reversesId: null, reversals: [],
      lines: [
        {itemId: 'soap', name: 'Soap', unit: 'pcs', quantity: '20.000', rate: '25.00', amount: '500.00', returned: !!mockStatus,
          rateChanged: true},
        {itemId: 'oil', name: 'Oil', unit: 'pcs', quantity: '2.000', rate: '100.00', amount: '200.00', returned: !!mockStatus},
      ]}),
    cancelBill: (...a: unknown[]) => (mockCancel as (...x: unknown[]) => unknown)(...a),
  },
}));
let mockConsent = 'opted_in';
jest.mock('@features/customers/data/statements.remote', () => ({
  statementsRemote: {consent: async () => ({status: mockConsent, since: null, source: null, history: []})},
}));
const mockSharePdf = jest.fn(async (..._a: unknown[]) => 'shared');
jest.mock('@features/customers/presentation/sharePdf', () => ({sharePdf: (...a: unknown[]) => mockSharePdf(...a)}));

const has = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id).length > 0;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => { r.root.findAll(n => n.props.testID === id && n.props.onPress)[0].props.onPress(); });
};
const confirm = async () => {
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  await act(async () => { buttons.find((b: {style?: string}) => b.style === 'destructive').onPress(); });
};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <BillDetailScreen navigation={{} as any} route={{params: {billId: 'b1'}} as any} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  return r;
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockCancel.mockClear();
});

test('the owner returns one line, or cancels the bill, after confirming', async () => {
  mockOwner = true;
  mockStatus = null;
  const r = await render();
  try {
    await press(r, 'bill-return');
    await press(r, 'return-oil');
    await press(r, 'return-confirm');
    expect(mockCancel).not.toHaveBeenCalled(); // asks first
    await confirm();
    expect(mockCancel).toHaveBeenCalledWith('b1', ['oil']);
    await press(r, 'bill-cancel');
    await confirm();
    expect(mockCancel).toHaveBeenLastCalledWith('b1', []);
  } finally {
    act(() => r.unmount());
  }
});

test('a cancelled bill says so and offers nothing; staff never see the actions', async () => {
  mockOwner = true;
  mockStatus = 'cancelled';
  let r = await render();
  expect(has(r, 'bill-status')).toBe(true);
  expect(has(r, 'bill-cancel') || has(r, 'bill-return')).toBe(false);
  act(() => r.unmount());
  mockOwner = false;
  mockStatus = null;
  r = await render();
  expect(has(r, 'bill-cancel') || has(r, 'bill-return')).toBe(false);
  act(() => r.unmount());
});

test('Share goes through sharePdf; without consent only email and save are offered (ST3)', async () => {
  mockOwner = true;
  mockStatus = null;
  mockConsent = 'opted_out';
  let r = await render();
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  const btn = (id: string) => r.root.findAll(n => n.props.testID === id && 'disabled' in n.props)[0];
  expect(btn('bill-share').props.disabled).toBe(false);  // saving / emailing a bill needs no consent
  await press(r, 'bill-share');
  expect(btn('pdf-whatsapp').props.disabled).toBe(true);
  expect(btn('pdf-share-sheet').props.disabled).toBe(true);  // the open sheet reaches WhatsApp too
  await press(r, 'pdf-email');
  expect(mockSharePdf).toHaveBeenLastCalledWith(expect.objectContaining({kind: 'bill'}), 'email');
  act(() => r.unmount());

  mockConsent = 'opted_in';
  r = await render();
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  await press(r, 'bill-share');
  expect(btn('pdf-whatsapp').props.disabled).toBe(false);
  await press(r, 'pdf-whatsapp');
  expect(mockSharePdf).toHaveBeenLastCalledWith(expect.objectContaining({kind: 'bill'}), 'whatsapp');
  act(() => r.unmount());
});

test('a line whose rate was changed on the bill says so; a catalogue-price line does not (BL8)', async () => {
  mockOwner = false;
  mockStatus = null;
  const r = await render();
  expect(has(r, 'rate-changed-soap')).toBe(true);
  expect(has(r, 'rate-changed-oil')).toBe(false);
  act(() => r.unmount());
});
