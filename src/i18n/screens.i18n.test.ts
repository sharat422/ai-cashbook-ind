/**
 * The Telugu-first screens — entry, statement, collection / reminders, daily
 * close, and the shared parts they use — must take every visible string and
 * error from t(). A hard-coded English title, label, placeholder or
 * Alert.alert message here fails the build. Add new screens in these areas
 * to SCOPE.
 */
import {readFileSync} from 'fs';
import {join} from 'path';

import {findHardcodedText} from './hardcodedText';

const SCOPE = [
  // first launch + onboarding
  'features/auth/screens/LoginScreen.tsx',
  'features/auth/screens/OtpScreen.tsx',
  'features/auth/screens/CreateBusinessScreen.tsx',
  'features/auth/components/LanguageToggle.tsx',
  'features/dashboard/presentation/screens/DashboardScreen.tsx',
  // entry
  'features/transactions/presentation/screens/QuickAddScreen.tsx',
  'features/income/presentation/screens/AddIncomeScreen.tsx',
  'features/expense/presentation/screens/AddExpenseScreen.tsx',
  'features/customers/presentation/screens/AddCreditScreen.tsx',
  'features/customers/presentation/screens/CustomerFormScreen.tsx',
  'features/customers/presentation/screens/CustomerListScreen.tsx',
  'features/customers/presentation/screens/CustomerProfileScreen.tsx',
  'features/customers/presentation/components/ReceivePaymentSheet.tsx',
  'features/customers/presentation/components/TransactionCard.tsx',
  'features/customers/presentation/components/CustomerCard.tsx',
  'features/customers/presentation/components/RiskInsightCard.tsx',
  'features/customers/presentation/components/RiskGauge.tsx',
  'features/schemes/presentation/screens/BillScreen.tsx',
  'components/form/AttachmentPicker.tsx',
  'components/form/DateField.tsx',
  'components/form/ChipSelect.tsx',
  // statement
  'features/customers/presentation/screens/CustomerStatementScreen.tsx',
  'features/customers/presentation/components/StatementDocument.tsx',
  'features/customers/presentation/components/StatementConsentCard.tsx',
  'features/customers/presentation/exportStatement.ts',
  // collection / reminders
  'features/collections/presentation/screens/RequestPaymentScreen.tsx',
  'features/collection/presentation/screens/CollectionAssistantScreen.tsx',
  'features/collection/presentation/components/MessageOptionCard.tsx',
  'features/reminders/presentation/components/SendReminderSheet.tsx',
  'features/reminders/presentation/components/TemplateEditorSheet.tsx',
  'features/reminders/presentation/components/ReminderHistoryList.tsx',
  // daily close
  'features/reconciliation/presentation/screens/DailyCloseScreen.tsx',
  'features/reconciliation/presentation/screens/ReconciliationScreen.tsx',
  // shared
  'components/ui/ErrorState.tsx',
  'components/ui/ErrorBoundary.tsx',
  'components/ui/Select.tsx',
  'features/settings/presentation/screens/SettingsScreen.tsx',
  'features/account/presentation/screens/YourDataScreen.tsx',
  // offline sync + import
  'features/sync/presentation/SyncStatusBar.tsx',
  'features/sync/presentation/SyncStatusScreen.tsx',
  'features/sync/presentation/SyncConflictScreen.tsx',
  'features/sync/syncStatus.ts',
  'features/import/presentation/KhataImportScreen.tsx',
  // team / accountant access
  'features/team/presentation/screens/TeamScreen.tsx',
  'features/team/presentation/screens/AccountantActivityScreen.tsx',
  'features/auth/components/BusinessSwitcher.tsx',
  'navigation/withPermission.tsx',
];

describe('Telugu-first screens have no hard-coded English', () => {
  it.each(SCOPE)('%s', file => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(findHardcodedText(source, file)).toEqual([]);
  });

  it('the checker catches English text, props and alerts', () => {
    const bad = `
      const X = () => <View><Text>Payment received</Text><Input placeholder="e.g. part payment" /></View>;
      Alert.alert('Could not save', 'Please try again.');`;
    expect(findHardcodedText(bad).map(f => f.text)).toEqual(
      ['Payment received', 'e.g. part payment', 'Could not save', 'Please try again.']);
    expect(findHardcodedText(`<Text className="text-sm font-bold">{t('x')} ₹ UPI</Text>`)).toEqual([]);
  });
});
