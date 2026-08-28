// The export module imports native file/share modules at the top level; stub
// them so the pure builders can be exercised under Node. xlsx is pure JS.
jest.mock('react-native-html-to-pdf', () => ({default: {convert: jest.fn()}}));
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp', writeFile: jest.fn()}));
jest.mock('react-native-share', () => ({default: {open: jest.fn()}}));

import * as XLSX from 'xlsx';

import type {ReportSummary, ReportTxn} from './entities';
import {
  buildReportWorkbook,
  summaryAoa,
  transactionsAoa,
  workbookToBase64,
} from './exportReport';

const summary: ReportSummary = {
  from: '2026-06-01',
  to: '2026-06-30',
  incomeTotal: 5000,
  expenseTotal: 1800,
  profit: 3200,
  incomeCount: 2,
  expenseCount: 1,
  incomeByCategory: [
    {category: 'Sales', amount: 4000, share: 0.8},
    {category: 'Services', amount: 1000, share: 0.2},
  ],
  expenseByCategory: [{category: 'Fuel', amount: 1800, share: 1}],
  source: 'remote',
};

const txns: ReportTxn[] = [
  {type: 'income', date: '2026-06-03', category: 'Sales', party: '', amount: 4000, notes: 'inv 1'},
  {type: 'expense', date: '2026-06-10', category: 'Fuel', party: 'HP Petrol', amount: 1800, notes: ''},
  {type: 'income', date: '2026-06-20', category: 'Services', party: '', amount: 1000, notes: ''},
];

describe('summaryAoa', () => {
  it('keeps amounts numeric (so Excel can sum them) and includes P&L + breakdowns', () => {
    const rows = summaryAoa(summary);
    const flat = rows.map(r => r.join('|'));
    expect(flat).toContain('Income total|5000');
    expect(flat).toContain('Net profit|3200');
    // Category rows carry numeric amount + integer share %.
    expect(rows).toContainEqual(['Sales', 4000, 80]);
    expect(rows).toContainEqual(['Fuel', 1800, 100]);
  });
});

describe('transactionsAoa', () => {
  it('is a ledger with separate Income/Expense columns and a totals row', () => {
    const rows = transactionsAoa(txns);
    expect(rows[0]).toEqual([
      'Date', 'Type', 'Category', 'Vendor / Payer', 'Income (₹)', 'Expense (₹)', 'Notes',
    ]);
    // Income row: amount in the Income column, Expense column blank.
    expect(rows[1]).toEqual(['2026-06-03', 'Income', 'Sales', '', 4000, '', 'inv 1']);
    // Expense row: amount in the Expense column.
    expect(rows[2]).toEqual(['2026-06-10', 'Expense', 'Fuel', 'HP Petrol', '', 1800, '']);
    // Totals row sums each column.
    expect(rows[rows.length - 1]).toEqual(['', '', '', 'Total', 5000, 1800, '']);
  });

  it('handles an empty range (header + totals only)', () => {
    const rows = transactionsAoa([]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['', '', '', 'Total', 0, 0, '']);
  });
});

describe('buildReportWorkbook → base64 (real .xlsx round-trip)', () => {
  it('produces a valid two-sheet workbook that reads back correctly', () => {
    const base64 = workbookToBase64(buildReportWorkbook(summary, txns));
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    // Read it back the way a spreadsheet app would.
    const wb = XLSX.read(base64, {type: 'base64'});
    expect(wb.SheetNames).toEqual(['P&L Summary', 'Transactions']);

    const txnSheet = wb.Sheets.Transactions;
    // A1 header + a known numeric cell (Income of the first row = 4000).
    expect(txnSheet.A1.v).toBe('Date');
    const asJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(txnSheet);
    expect(asJson).toHaveLength(4); // 3 txns + totals row
    expect(asJson[0]['Income (₹)']).toBe(4000);
  });
});
