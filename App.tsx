/**
 * Smart CashBook
 * Root application component.
 *
 * @format
 */

import './global.css';

import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {QueryProvider} from '@/providers/QueryProvider';
import {CreditSyncManager} from '@features/customers/presentation/CreditSyncManager';
import {DailySummaryManager} from '@features/daily-summary/presentation/DailySummaryManager';
import {ExpenseSyncManager} from '@features/expense/presentation/ExpenseSyncManager';
import {OfflineSyncManager} from '@features/income/presentation/OfflineSyncManager';
import {RootNavigator} from '@navigation/RootNavigator';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        {/* Keep the offline queues syncing in the background. */}
        <OfflineSyncManager />
        <ExpenseSyncManager />
        <CreditSyncManager />
        {/* Dispatches the daily summary notification when due. */}
        <DailySummaryManager />
        <RootNavigator />
      </QueryProvider>
    </SafeAreaProvider>
  );
}

export default App;
