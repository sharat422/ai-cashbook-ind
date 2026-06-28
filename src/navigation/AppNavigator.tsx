import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React from 'react';

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
import {TransactionHistoryScreen} from '@features/transactions/presentation/screens/TransactionHistoryScreen';
import type {AppStackParamList} from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

/** Main app for fully onboarded users. */
export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen
        name="AddIncome"
        component={AddIncomeScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="AddExpense"
        component={AddExpenseScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="TransactionHistory"
        component={TransactionHistoryScreen}
      />
      <Stack.Screen
        name="ReceiptCapture"
        component={ReceiptCaptureScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen name="ReceiptReview" component={ReceiptReviewScreen} />
      <Stack.Screen
        name="Categorize"
        component={CategorizationScreen}
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
        component={CustomerFormScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="AddCredit"
        component={AddCreditScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="CustomerStatement"
        component={CustomerStatementScreen}
      />
      <Stack.Screen
        name="CollectionAssistant"
        component={CollectionAssistantScreen}
      />
    </Stack.Navigator>
  );
}
