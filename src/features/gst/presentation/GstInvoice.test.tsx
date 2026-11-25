/**
 * The tax invoice screen shows the server's figures (lines, CGST/SGST or IGST,
 * totals) and shares the server-made PDF through the one door; the GST reports
 * screen downloads the CA/Tally file for the month.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {Customer} from '@features/customers/domain/entities';
import type {LedgerEntry} from '@features/customers/domain/ledger';
import {useAuthStore} from '@store/auth.store';
import {GstInvoiceScreen} from './GstInvoiceScreen';
import {GstReportsScreen} from './GstReportsScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => true})}));
const mockShare = jest.fn(async (..._a: unknown[]) => 'shared');
jest.mock('@features/customers/presentation/sharePdf', () => ({sharePdf: (...a: unknown[]) => mockShare(...a)}));
jest.mock('@features/customers/data/statements.remote', () => ({
  statementsRemote: {consent: async () => ({status: 'opted_in'})},
}));
const mockDownload = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@features/gst/data/gst.remote', () => ({
  gstRemote: {
    summary: async () => ({invoices: 3, rateChanges: 0, taxableValue: '0', cgst: '0', sgst: '0', igst: '0', total: '0'}),
    caTests: async () => [],
    download: (...a: unknown[]) => mockDownload(...a),
  },
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c !== 'object').join('')).join(' | ');
const press = async (r: ReactTestRenderer, match: (n: {props: Record<string, unknown>}) => boolean) => {
  const b = r.root.findAll(n => typeof n.props.onPress === 'function' && match(n))[0];
  await act(async () => { (b.props.onPress as () => void)(); });
};
const wrap = (el: React.ReactElement) =>
  <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>;
const settle = () => act(async () => { await new Promise(res => setTimeout(res, 20)); });

const customer = {id: 'c1', fullName: 'Gupta Stores'} as Customer;
const entry: LedgerEntry = {
  id: 'e1', type: 'credit', amount: 1180, date: '2026-11-23', invoiceNumber: '26-27/00001', gstStatus: 'issued',
  createdAt: '2026-11-23T10:00:00Z',
  gst: {customerGstin: '29AAPFU0939F1ZR', placeOfSupply: '29', taxableValue: '1000.00', cgst: '90.00', sgst: '90.00',
    igst: '0.00', lines: [{itemName: 'Sona Masoori Rice 25kg', hsn: '1006', rate: '18', quantity: '10', uqc: 'BAG',
      taxableValue: '1000.00', cgst: '90.00', sgst: '90.00', igst: '0.00'}]},
};

test('the invoice screen shows the server figures and shares the PDF', async () => {
  useAuthStore.setState({business: {businessName: 'Test Traders', gstin: '29AAACS1234B1ZW', state: 'Karnataka',
    address: '14 Market Road, Mysuru 570001'}} as never);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<GstInvoiceScreen navigation={{} as never} route={{params: {customer, entry}} as never} />));
  });
  await settle();
  const text = textOf(r);
  for (const s of ['Tax invoice', 'Invoice 26-27/00001', '14 Market Road, Mysuru 570001', 'Bill to: Gupta Stores',
    'GSTIN 29AAPFU0939F1ZR',
    'Sona Masoori Rice 25kg · 1006', '10 BAG · 18%', 'Place of supply: 29-Karnataka']) expect(text).toContain(s);
  // Totals: taxable 1,000 + CGST 90 + SGST 90 = 1,180; no IGST inside the state.
  const totals = r.root.findAllByProps({testID: 'invoice-totals'})[0];
  const rows = totals.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join(''));
  expect(rows).toEqual(['Taxable value', '₹1,000.00', 'CGST', '₹90.00', 'SGST', '₹90.00', 'IGST', '₹0.00',
    'Invoice total', '₹1,180.00']);

  await press(r, n => n.props.testID === 'invoice-share');
  await press(r, n => n.props.testID === 'pdf-email');
  expect(mockShare).toHaveBeenCalledWith({kind: 'invoice', customer, entryId: 'e1', invoiceNumber: '26-27/00001'}, 'email');
  act(() => r.unmount());
});

test('the GST reports screen downloads the Tally CSV for the month', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(wrap(<GstReportsScreen navigation={{} as never} route={{} as never} />));
  });
  await settle();
  await press(r, n => n.props.title === 'Download Tally export (CSV)');
  expect(mockDownload).toHaveBeenCalledWith('tally-export.csv', expect.stringMatching(/^\d{4}-\d{2}-01$/),
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  act(() => r.unmount());
});

test('the download asks the server for the file and saves it with a dated name', async () => {
  jest.resetModules();
  const downloadAndShare = jest.fn(async () => undefined);
  jest.doMock('@api/download', () => ({downloadAndShare}));
  const {gstRemote} = jest.requireActual('@features/gst/data/gst.remote');
  await gstRemote.download('tally-export.csv', '2026-11-01', '2026-11-30');
  expect(downloadAndShare).toHaveBeenCalledWith('/reports/tally-export.csv?from=2026-11-01&to=2026-11-30',
    'Tally_sales_2026-11-01_2026-11-30.csv', 'text/csv');
});
