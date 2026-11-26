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
const mockSummary: ReportSummary = {
  from: '2026-11-20', to: '2026-11-26', incomeTotal: 4602, expenseTotal: 0, profit: 4602,
  incomeCount: 3, expenseCount: 0, source: 'remote',
  incomeByCategory: [{category: 'Credit sales', amount: 4602, share: 1}], expenseByCategory: [],
};
jest.mock('@features/reports/presentation/hooks/useReportSummary', () => ({
  useReportSummary: () => ({data: mockSummary, isLoading: false, isError: false, error: null,
    refetch: jest.fn(), isRefetching: false}),
}));

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join(' | ');

test('credit sales show as sales, with profit, not an empty report', async () => {
  useAuthStore.setState({preferredLanguage: 'en'});
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<ReportsScreen />); });
  const text = textOf(r);
  expect(text).not.toContain('Nothing to report');
  expect(text).toContain('Credit sales (khata)');
  expect(text.match(/₹4,602/g)?.length).toBeGreaterThanOrEqual(3); // profit, income, the category
  act(() => r.unmount());
});
