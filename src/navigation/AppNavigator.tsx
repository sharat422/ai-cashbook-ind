import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React from 'react';

import {PERMISSIONS} from '@features/auth/rbac';
import {withPermission} from './withPermission';

import {CategorizationScreen} from '@features/categorization/presentation/screens/CategorizationScreen';
import {CollectionAssistantScreen} from '@features/collection/presentation/screens/CollectionAssistantScreen';
import {AddCreditScreen} from '@features/customers/presentation/screens/AddCreditScreen';
import {CustomerFormScreen} from '@features/customers/presentation/screens/CustomerFormScreen';
import {CustomerStatementScreen} from '@features/customers/presentation/screens/CustomerStatementScreen';
import {CustomerListScreen} from '@features/customers/presentation/screens/CustomerListScreen';
import {CustomerProfileScreen} from '@features/customers/presentation/screens/CustomerProfileScreen';
import {DailySummaryScreen} from '@features/daily-summary/presentation/screens/DailySummaryScreen';
import {DashboardScreen} from '@features/dashboard/presentation/screens/DashboardScreen';
import {AddExpenseScreen} from '@features/expense/presentation/screens/AddExpenseScreen';
import {AddIncomeScreen} from '@features/income/presentation/screens/AddIncomeScreen';
import {KhataDashboardScreen} from '@features/khata/presentation/screens/KhataDashboardScreen';
import {KhataInsightsScreen} from '@features/insights/presentation/screens/KhataInsightsScreen';
import {NotificationsScreen} from '@features/notifications/presentation/screens/NotificationsScreen';
import {ReceiptCaptureScreen} from '@features/receipt-scanner/presentation/screens/ReceiptCaptureScreen';
import {ReceiptReviewScreen} from '@features/receipt-scanner/presentation/screens/ReceiptReviewScreen';
import {AITransactionScreen} from '@features/ai-entry/presentation/screens/AITransactionScreen';
import {RequestPaymentScreen} from '@features/collections/presentation/screens/RequestPaymentScreen';
import {CustomerInsightsScreen} from '@features/customer-intel/presentation/screens/CustomerInsightsScreen';
import {CashCounterScreen} from '@features/cash-counter/presentation/screens/CashCounterScreen';
import {BusinessScreen} from '@features/business/presentation/screens/BusinessScreen';
import {AssistantScreen} from '@features/assistant/presentation/screens/AssistantScreen';
import {ItemListScreen} from '@features/items/presentation/screens/ItemListScreen';
import {ItemFormScreen} from '@features/items/presentation/screens/ItemFormScreen';
import {RecurringListScreen} from '@features/recurring/presentation/screens/RecurringListScreen';
import {RecurringFormScreen} from '@features/recurring/presentation/screens/RecurringFormScreen';
import {BeatDayListScreen} from '@features/beats/presentation/screens/BeatDayListScreen';
import {VisitHistoryScreen} from '@features/beats/presentation/screens/VisitHistoryScreen';
import {BeatPlanScreen} from '@features/beats/presentation/screens/BeatPlanScreen';
import {BillScreen} from '@features/schemes/presentation/screens/BillScreen';
import {BillDetailScreen} from '@features/schemes/presentation/screens/BillDetailScreen';
import {SchemeFormScreen} from '@features/schemes/presentation/screens/SchemeFormScreen';
import {SchemeReportScreen} from '@features/schemes/presentation/screens/SchemeReportScreen';
import {SchemesScreen} from '@features/schemes/presentation/screens/SchemesScreen';
import {BulkStatementsScreen} from '@features/customers/presentation/screens/BulkStatementsScreen';
import {StockCountScreen} from '@features/stock/presentation/screens/StockCountScreen';
import {StockHistoryScreen} from '@features/stock/presentation/screens/StockHistoryScreen';
import {StockScreen} from '@features/stock/presentation/screens/StockScreen';
import {VanStockScreen} from '@features/stock/presentation/screens/VanStockScreen';
import {GstReportsScreen} from '@features/gst/presentation/GstReportsScreen';
import {DailyCloseScreen} from '@features/reconciliation/presentation/screens/DailyCloseScreen';
import {BankImportScreen} from '@features/reconciliation/presentation/screens/BankImportScreen';
import {BankMatchScreen} from '@features/reconciliation/presentation/screens/BankMatchScreen';
import {ReconciliationScreen} from '@features/reconciliation/presentation/screens/ReconciliationScreen';
import {AccountantActivityScreen} from '@features/team/presentation/screens/AccountantActivityScreen';
import {TeamScreen} from '@features/team/presentation/screens/TeamScreen';
import {DiagnosticsScreen} from '@features/diagnostics/presentation/screens/DiagnosticsScreen';
import {HelpScreen} from '@features/support/presentation/screens/HelpScreen';
import {FeedbackScreen} from '@features/support/presentation/screens/FeedbackScreen';
import {ReportsScreen} from '@features/reports/presentation/screens/ReportsScreen';
import {SettingsScreen} from '@features/settings/presentation/screens/SettingsScreen';
import {ConsentSettingsScreen} from '@features/consent/presentation/screens/ConsentSettingsScreen';
import {BusinessEditScreen} from '@features/account/presentation/screens/BusinessEditScreen';
import {DeleteAccountScreen} from '@features/account/presentation/screens/DeleteAccountScreen';
import {YourDataScreen} from '@features/account/presentation/screens/YourDataScreen';
import {KhataImportScreen} from '@features/import/presentation/KhataImportScreen';
import {SyncConflictScreen} from '@features/sync/presentation/SyncConflictScreen';
import {StockConflictScreen} from '@features/sync/presentation/StockConflictScreen';
import {SyncStatusScreen} from '@features/sync/presentation/SyncStatusScreen';
import {LegalDocScreen} from '@features/legal/presentation/screens/LegalDocScreen';
import {TransactionHistoryScreen} from '@features/transactions/presentation/screens/TransactionHistoryScreen';
import {QuickAddScreen} from '@features/transactions/presentation/screens/QuickAddScreen';
import type {AppStackParamList} from './types';

/** Screens that write: a role without the permission sees a read-only page. */
const Guarded = {
  AITransactionScreen: withPermission(AITransactionScreen, PERMISSIONS.ENTRY_CREATE),
  QuickAddScreen: withPermission(QuickAddScreen, PERMISSIONS.ENTRY_CREATE),
  AddIncomeScreen: withPermission(AddIncomeScreen, PERMISSIONS.ENTRY_CREATE),
  AddExpenseScreen: withPermission(AddExpenseScreen, PERMISSIONS.ENTRY_CREATE),
  ReceiptCaptureScreen: withPermission(ReceiptCaptureScreen, PERMISSIONS.ENTRY_CREATE),
  ReceiptReviewScreen: withPermission(ReceiptReviewScreen, PERMISSIONS.ENTRY_CREATE),
  AddCreditScreen: withPermission(AddCreditScreen, PERMISSIONS.ENTRY_CREATE),
  CustomerFormScreen: withPermission(CustomerFormScreen, PERMISSIONS.ENTRY_CREATE),
  BillScreen: withPermission(BillScreen, PERMISSIONS.ENTRY_CREATE),
  RequestPaymentScreen: withPermission(RequestPaymentScreen, PERMISSIONS.ENTRY_CREATE),
  CollectionAssistantScreen: withPermission(CollectionAssistantScreen, PERMISSIONS.ENTRY_CREATE),
  CashCounterScreen: withPermission(CashCounterScreen, PERMISSIONS.ENTRY_CREATE),
  CategorizationScreen: withPermission(CategorizationScreen, PERMISSIONS.ENTRY_EDIT),
  StockCountScreen: withPermission(StockCountScreen, PERMISSIONS.ENTRY_EDIT),
  KhataImportScreen: withPermission(KhataImportScreen, PERMISSIONS.ENTRY_EDIT),
  BankImportScreen: withPermission(BankImportScreen, PERMISSIONS.ENTRY_EDIT),
  BankMatchScreen: withPermission(BankMatchScreen, PERMISSIONS.ENTRY_EDIT),
  BusinessEditScreen: withPermission(BusinessEditScreen, PERMISSIONS.SETTINGS_MANAGE),
  ItemFormScreen: withPermission(ItemFormScreen, PERMISSIONS.SETTINGS_MANAGE),
  RecurringFormScreen: withPermission(RecurringFormScreen, PERMISSIONS.SETTINGS_MANAGE),
  SchemeFormScreen: withPermission(SchemeFormScreen, PERMISSIONS.SETTINGS_MANAGE),
  TeamScreen: withPermission(TeamScreen, PERMISSIONS.TEAM_MANAGE),
  AccountantActivityScreen: withPermission(AccountantActivityScreen, PERMISSIONS.TEAM_MANAGE),
  BeatPlanScreen: withPermission(BeatPlanScreen, PERMISSIONS.BEATS_MANAGE),
};

const Stack = createNativeStackNavigator<AppStackParamList>();

/** Main app for fully onboarded users. */
export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="ConsentSettings" component={ConsentSettingsScreen} />
      <Stack.Screen name="BusinessEdit" component={Guarded.BusinessEditScreen} />
      <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
      <Stack.Screen name="YourData" component={YourDataScreen} />
      <Stack.Screen name="SyncStatus" component={SyncStatusScreen} />
      <Stack.Screen name="SyncConflict" component={SyncConflictScreen} />
      <Stack.Screen name="StockConflict" component={StockConflictScreen} />
      <Stack.Screen name="KhataImport" component={Guarded.KhataImportScreen} />
      <Stack.Screen name="BankImport" component={Guarded.BankImportScreen} />
      <Stack.Screen name="VisitHistory" component={VisitHistoryScreen} />
      <Stack.Screen name="BankMatch" component={Guarded.BankMatchScreen} />
      <Stack.Screen name="LegalDoc" component={LegalDocScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen name="CustomerInsights" component={CustomerInsightsScreen} />
      <Stack.Screen name="CashCounter" component={Guarded.CashCounterScreen} />
      <Stack.Screen name="Business" component={BusinessScreen} />
      <Stack.Screen name="Assistant" component={AssistantScreen} />
      <Stack.Screen
        name="AITransaction"
        component={Guarded.AITransactionScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen name="Items" component={ItemListScreen} />
      <Stack.Screen
        name="ItemForm"
        component={Guarded.ItemFormScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen name="Recurring" component={RecurringListScreen} />
      <Stack.Screen
        name="RecurringForm"
        component={Guarded.RecurringFormScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen name="Team" component={Guarded.TeamScreen} />
      <Stack.Screen name="AccountantActivity" component={Guarded.AccountantActivityScreen} />
      <Stack.Screen name="BeatPlan" component={Guarded.BeatPlanScreen} />
      <Stack.Screen name="BeatDayList" component={BeatDayListScreen} />
      <Stack.Screen name="Reconciliation" component={ReconciliationScreen} />
      <Stack.Screen name="DailyClose" component={DailyCloseScreen} />
      <Stack.Screen name="GstReports" component={GstReportsScreen} />
      <Stack.Screen name="Stock" component={StockScreen} />
      <Stack.Screen name="StockCount" component={Guarded.StockCountScreen} />
      <Stack.Screen name="StockHistory" component={StockHistoryScreen} />
      <Stack.Screen name="VanStock" component={VanStockScreen} />
      <Stack.Screen name="Bill" component={Guarded.BillScreen} />
      <Stack.Screen name="BillDetail" component={BillDetailScreen} />
      <Stack.Screen name="Schemes" component={SchemesScreen} />
      <Stack.Screen name="BulkStatements" component={BulkStatementsScreen} />
      <Stack.Screen name="SchemeForm" component={Guarded.SchemeFormScreen} />
      <Stack.Screen name="SchemeReport" component={SchemeReportScreen} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen
        name="Feedback"
        component={FeedbackScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="QuickAdd"
        component={Guarded.QuickAddScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="AddIncome"
        component={Guarded.AddIncomeScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="AddExpense"
        component={Guarded.AddExpenseScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="TransactionHistory"
        component={TransactionHistoryScreen}
      />
      <Stack.Screen
        name="ReceiptCapture"
        component={Guarded.ReceiptCaptureScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen name="ReceiptReview" component={Guarded.ReceiptReviewScreen} />
      <Stack.Screen
        name="Categorize"
        component={Guarded.CategorizationScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen name="DailySummary" component={DailySummaryScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="KhataDashboard" component={KhataDashboardScreen} />
      <Stack.Screen name="KhataInsights" component={KhataInsightsScreen} />
      <Stack.Screen name="Customers" component={CustomerListScreen} />
      <Stack.Screen name="CustomerProfile" component={CustomerProfileScreen} />
      <Stack.Screen
        name="CustomerForm"
        component={Guarded.CustomerFormScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="AddCredit"
        component={Guarded.AddCreditScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="CustomerStatement"
        component={CustomerStatementScreen}
      />
      <Stack.Screen name="RequestPayment" component={Guarded.RequestPaymentScreen} />
      <Stack.Screen
        name="CollectionAssistant"
        component={Guarded.CollectionAssistantScreen}
      />
    </Stack.Navigator>
  );
}
