/**
 * The import screen: the preview is a dry run (nothing is imported until the
 * owner confirms), a file whose rows are all duplicates offers nothing to
 * import, and the whole flow reads in Telugu.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {hasWords} from '@/i18n/hardcodedText';
import {useAuthStore} from '@store/auth.store';
import type {ImportPreview} from '../import.remote';
import {KhataImportScreen} from './KhataImportScreen';

jest.setTimeout(90_000); // first render loads the whole screen tree

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: async () => [{uri: 'file:///khata.csv', name: 'khata.csv', type: 'text/csv'}],
  types: {allFiles: '*/*'},
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: () => false,
}));
jest.mock('@api/download', () => ({downloadAndShare: jest.fn()}));
const mockPreview = jest.fn();
const mockRun = jest.fn();
jest.mock('../import.remote', () => ({
  ...jest.requireActual('../import.remote'),
  importRemote: {
    preview: (...a: unknown[]) => mockPreview(...a),
    run: (...a: unknown[]) => mockRun(...a),
    history: async () => [],
  },
}));

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  fileName: 'khata.csv', headers: ['Date', 'Retailer', 'Bill No', 'Amount', 'Type', 'Opening'], headerRow: 1,
  mapping: {date: 0, retailer: 1, billRef: 2, amount: 3, type: 4, opening: 5}, missing: [],
  rowCount: 500, toImport: 493, skipped: 7, newRetailers: ['Shop 1', 'Shop 2'],
  duplicateCount: 5, duplicates: [{row: 496, retailer: 'Shop 0', billRef: 'B-20', amount: 120, date: '2026-03-21', against: 'file'}],
  issueCount: 2, issues: [{row: 500, reason: 'bad_amount'}, {row: 501, reason: 'missing_retailer'}],
  openingTotal: 2010, udharTotal: 60000, jamaTotal: 58000, ...over,
});

async function openWithFile(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}})}>
        <KhataImportScreen navigation={{} as any} route={{} as any} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await r.root.findByProps({testID: 'import-pick'}).props.onPress(); });
  return r;
}
const runButton = (r: ReactTestRenderer) => r.root.findAll(n => n.props.testID === 'import-run' && 'disabled' in n.props)[0];
const strings = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).filter(Boolean);

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({preferredLanguage: 'en', business: {id: 'b1', role: 'owner'} as any});
});

it('shows the dry run and imports only after the owner confirms', async () => {
  mockPreview.mockResolvedValue(preview());
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const r = await openWithFile();
  const text = strings(r).join('\n');
  expect(text).toContain('Dry run — nothing has been saved yet');
  expect(text).toContain('Rows in the file: 500');
  expect(text).toContain('Will be imported: 493');
  expect(text).toContain('Duplicates (will be skipped): 5');
  expect(text).toContain('Row 500: amount is not a number');
  expect(mockRun).not.toHaveBeenCalled();

  await act(async () => { await runButton(r).props.onPress(); });
  expect(mockRun).not.toHaveBeenCalled(); // a confirm dialog first
  const confirm = alert.mock.calls[0][2]!.find(b => b.style !== 'cancel')!;
  mockRun.mockResolvedValue({id: 'l1', rowsImported: 493, rowsSkipped: 7, newRetailers: 2});
  await act(async () => { confirm.onPress!(); });
  expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({name: 'khata.csv'}), preview().mapping);
});

it('re-importing the same file offers nothing to import', async () => {
  mockPreview.mockResolvedValue(preview({toImport: 0, newRetailers: [], duplicateCount: 498}));
  const r = await openWithFile();
  expect(runButton(r).props.disabled).toBe(true);
});

it('changing a column re-runs the dry run with the new mapping', async () => {
  mockPreview.mockResolvedValue(preview());
  const r = await openWithFile();
  const select = r.root.findByProps({testID: 'map-opening'}).findAll(n => typeof n.props.onSelect === 'function')[0];
  await act(async () => { select.props.onSelect('none'); });
  expect(mockPreview).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({opening: null, amount: 3}));
});

it('reads in Telugu', async () => {
  useAuthStore.setState({preferredLanguage: 'te'});
  mockPreview.mockResolvedValue(preview());
  const r = await openWithFile();
  const names = ['Shop 0', 'Shop 1', 'Shop 2', 'B-20', 'khata.csv', 'Date', 'Retailer', 'Bill No', 'Amount', 'Type', 'Opening'];
  const english = strings(r).filter(s => hasWords(names.reduce((acc, n) => acc.split(n).join(''), s)));
  expect(english).toEqual([]);
});
