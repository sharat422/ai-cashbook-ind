/** ST3 on the phone: every statement / ledger / bill file goes through
 *  sharePdf — the server's consent check and log first, the file only after,
 *  and only on the chosen channel. */
import {Alert} from 'react-native';

import {ApiError} from '@api/client';

const mockShareSingle = jest.fn(async (..._a: unknown[]) => ({}));
const mockOpen = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {
    shareSingle: (...a: unknown[]) => mockShareSingle(...a),
    open: (...a: unknown[]) => mockOpen(...a),
    Social: {WHATSAPP: 'whatsapp', EMAIL: 'email'},
  },
}));
const mockConvert = jest.fn(async (..._a: unknown[]) => ({filePath: '/docs/Statement_Ravi.pdf'}));
jest.mock('react-native-html-to-pdf', () => ({convert: (...a: unknown[]) => mockConvert(...a)}));
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/docs', DownloadDirectoryPath: '/dl',
  writeFile: jest.fn(async () => undefined), copyFile: jest.fn(async () => undefined)}));
const mockDownload = jest.fn(async (_p: string, name: string) => `/docs/${name}`);
jest.mock('@api/download', () => ({downloadFile: (p: string, n: string) => mockDownload(p, n)}));
jest.mock('@features/customers/domain/statementHtml', () => ({buildStatementHtml: () => '<html/>'}));
const mockPdfShare = jest.fn();
jest.mock('@features/customers/data/statements.remote', () => ({
  statementsRemote: {pdfShare: (...a: unknown[]) => mockPdfShare(...a)},
}));
const mockShareBill = jest.fn();
jest.mock('@features/schemes/data/schemes.remote', () => ({
  schemesRemote: {shareBill: (...a: unknown[]) => mockShareBill(...a)},
}));

import {sharePdf} from './sharePdf';

const customer = {id: 'c1', fullName: 'Ravi Stores'} as never;
const statement = {rows: []} as never;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

test('no consent: refused with the reason, and no file is made or shared', async () => {
  mockPdfShare.mockRejectedValue(new ApiError(409, 'No consent — ask the retailer to opt in.'));
  const out = await sharePdf({kind: 'statement', format: 'pdf', customer, statement}, 'whatsapp');
  expect(out).toBe('refused');
  expect(Alert.alert).toHaveBeenCalledWith('No WhatsApp consent', 'No consent — ask the retailer to opt in.');
  expect(mockConvert).not.toHaveBeenCalled();
  expect(mockShareSingle).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
});

test('email: checked and logged first, then the email app only', async () => {
  mockPdfShare.mockResolvedValue({status: 'ok', mobile: '9876543210', pdfUrl: null});
  await sharePdf({kind: 'statement', format: 'pdf', customer, statement, from: '2026-10-01', to: '2026-10-31'}, 'email');
  expect(mockPdfShare).toHaveBeenCalledWith('c1', 'statement', 'email', '2026-10-01', '2026-10-31', false);
  expect(mockPdfShare.mock.invocationCallOrder[0]).toBeLessThan(mockConvert.mock.invocationCallOrder[0]);
  expect(mockShareSingle).toHaveBeenCalledWith(expect.objectContaining({social: 'email'}));
  expect(mockOpen).not.toHaveBeenCalled();  // not the open sheet, which could reach WhatsApp
});

test('the ledger and the bill are fetched only from the link the check hands out', async () => {
  mockPdfShare.mockResolvedValue({status: 'ok', mobile: '9876543210', pdfUrl: '/customers/c1/ledger.pdf?share=t'});
  await sharePdf({kind: 'ledger', customer, from: '2026-04-01', to: '2026-11-11'}, 'whatsapp');
  expect(mockDownload).toHaveBeenCalledWith('/customers/c1/ledger.pdf?share=t', expect.stringMatching(/^Ledger_/));
  expect(mockShareSingle).toHaveBeenCalledWith(expect.objectContaining({social: 'whatsapp', whatsAppNumber: '919876543210'}));

  mockShareBill.mockResolvedValue({status: 'ready', mobile: '9876543210', pdfUrl: '/bills/b1.pdf?share=t'});
  await sharePdf({kind: 'bill', bill: {id: 'b1', billNumber: 'B-26-27-3'} as never}, 'share_sheet');
  expect(mockShareBill).toHaveBeenCalledWith('b1', 'share_sheet');
  expect(mockDownload).toHaveBeenLastCalledWith('/bills/b1.pdf?share=t', 'Bill_B-26-27-3.pdf');
  expect(mockOpen).toHaveBeenCalledTimes(1);
});
