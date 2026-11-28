/**
 * Reports P&L for a distributor who sells only on credit: the server counts
 * khata credit sales as income (its own "Credit sales" category), so the
 * screen shows the sales and the profit, not "Nothing to report" or ₹0, and
 * the category is named in the user's language.
 */
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {ReportSummary} from '@features/reports/domain/entities';
import {useAuthStore} from '@store/auth.store';
import {ReportsScreen} from './ReportsScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('@features/reports/domain/exportReport', () => ({exportReportPdf: jest.fn(), exportReportXlsx: jest.fn()}));
jest.mock('@features/reports/data/reportTransactions', () => ({getReportTransactions: jest.fn()}));
let mockSummary: ReportSummary;
const creditOnly: ReportSummary = {
  from: '2026-11-20', to: '2026-11-26', incomeTotal: 4602, creditSales: 4602, cashSales: 0, expenseTotal: 0, profit: 4602,
  incomeCount: 3, expenseCount: 0, source: 'remote',
  incomeByCategory: [{category: 'Credit sales', amount: 4602, share: 1}], expenseByCategory: [],
};
jest.mock('@features/reports/presentation/hooks/useReportSummary', () => ({
  useReportSummary: () => ({data: mockSummary, isLoading: false, isError: false, error: null,
    refetch: jest.fn(), isRefetching: false}),
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join(' | ');

async function render(summary: ReportSummary) {
  mockSummary = summary;
  useAuthStore.setState({preferredLanguage: 'en'});
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<ReportsScreen />); });
  const sales = r.root.findAll(n => n.props.testID === 'reports-sales');
  return {r, text: textOf(r), sales: sales.length ? textOf({root: sales[0]} as ReactTestRenderer) : null};
}

test('credit sales show as sales, with profit, not an empty report', async () => {
  const {r, text, sales} = await render(creditOnly);
  expect(text).not.toContain('Nothing to report');
  expect(text).toContain('Credit sales (khata)');
  expect(text.match(/₹4,602/g)?.length).toBeGreaterThanOrEqual(3); // profit, income, the category
  expect(sales).toContain('Credit sales (khata) | ₹4,602 | Cash sales | ₹0 | Total sales | ₹4,602');
  act(() => r.unmount());
});

test('credit and cash sales: both lines and their total', async () => {
  const {r, sales} = await render({...creditOnly, incomeTotal: 5102, cashSales: 500, profit: 5102,
    incomeByCategory: [{category: 'Credit sales', amount: 4602, share: 0.9}, {category: 'Sales', amount: 500, share: 0.1}]});
  expect(sales).toContain('Credit sales (khata) | ₹4,602 | Cash sales | ₹500 | Total sales | ₹5,102');
  act(() => r.unmount());
});

test('offline: no split, since the device does not hold the khata', async () => {
  const {creditSales: _c, cashSales: _s, ...local} = creditOnly;
  const {r, sales} = await render({...local, source: 'local'});
  expect(sales).toBeNull();
  act(() => r.unmount());
});
