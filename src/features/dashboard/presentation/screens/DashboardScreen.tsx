import React, {useCallback, useMemo} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {Button, EmptyState, ErrorState, Screen, Text} from '@components/ui';
import {isSummaryEmpty} from '@features/dashboard/domain/entities';
import {
  SummarySkeleton,
  SummaryWidgets,
} from '@features/dashboard/presentation/components';
import {useDashboardSummary} from '@features/dashboard/presentation/hooks/useDashboardSummary';
import {DeviceIntegrityBanner} from '@features/security/presentation/DeviceIntegrityBanner';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useConnectivity} from '@features/income/presentation/hooks';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useUnreadCount} from '@/services/notifications';
import {useT} from '@/i18n';
import type {SyncStatus} from '@/shared/types/attachment';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

/** Cap recent activity so a long history never bloats the render tree. */
const RECENT_LIMIT = 8;

interface ActivityItem {
  id: string;
  kind: 'income' | 'expense';
  title: string;
  date: string;
  amount: number;
  createdAt: string;
  syncStatus: SyncStatus;
}

/**
 * Dashboard: 5 summary widgets (React Query) with pull-to-refresh, skeleton
 * loaders, empty + error states, plus quick actions and recent activity.
 */
export function DashboardScreen({
  navigation,
}: AppScreenProps<'Dashboard'>): React.JSX.Element {
  const t = useT();
  const business = useAuthStore(state => state.business);
  const logout = useAuthStore(state => state.logout);
  const incomes = useIncomeStore(state => state.entries);
  const expenses = useExpenseStore(state => state.entries);
  const pendingCount =
    useIncomeStore(state => state.queue.length) +
    useExpenseStore(state => state.queue.length);
  const online = useConnectivity();
  const unreadCount = useUnreadCount();

  const {data, isLoading, isError, error, refetch, isRefetching} =
    useDashboardSummary();

  const activity = useMemo<ActivityItem[]>(() => {
    const merged: ActivityItem[] = [
      ...incomes.map(e => ({
        id: e.id,
        kind: 'income' as const,
        title: e.category,
        date: e.date,
        amount: e.amount,
        createdAt: e.createdAt,
        syncStatus: e.syncStatus,
      })),
      ...expenses.map(e => ({
        id: e.id,
        kind: 'expense' as const,
        title: `${e.category} · ${e.vendor}`,
        date: e.date,
        amount: e.amount,
        createdAt: e.createdAt,
        syncStatus: e.syncStatus,
      })),
    ];
    return merged
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, RECENT_LIMIT);
  }, [incomes, expenses]);

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const onLogout = () => {
    Alert.alert(t('common.logoutConfirmTitle'), t('common.logoutConfirmMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('common.logout'), style: 'destructive', onPress: logout},
    ]);
  };

  const showSkeleton = isLoading && !data;
  const showError = isError && !data;
  const showEmpty =
    !!data && isSummaryEmpty(data) && activity.length === 0;

  return (
    <Screen scroll={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }>
        {/* Header */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text variant="caption">{t('dashboard.welcome')}</Text>
            <Text variant="title" className="mt-1">
              {business?.businessName ?? t('dashboard.yourBusiness')}
            </Text>
          </View>
          <View className="flex-row items-center" style={{gap: 8}}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => navigation.navigate('Notifications')}
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-white">
              <Text className="text-lg">🔔</Text>
              {unreadCount > 0 ? (
                <View className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1">
                  <Text className="text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={() => navigation.navigate('Settings')}
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-white">
              <Text className="text-lg">⚙️</Text>
            </Pressable>
          </View>
        </View>
        {!online ? (
          <Text className="mt-2 text-sm font-medium text-amber-700">
            {t('dashboard.offline')}
            {pendingCount > 0
              ? t('dashboard.pendingSyncSuffix', {count: pendingCount})
              : ''}
          </Text>
        ) : pendingCount > 0 ? (
          <Text className="mt-2 text-sm font-medium text-muted">
            {t('dashboard.syncing', {count: pendingCount})}
          </Text>
        ) : null}

        {/* Non-blocking warning if the device looks rooted/jailbroken */}
        <DeviceIntegrityBanner />

        {/* Summary widgets — skeleton / error / empty / data */}
        <View className="mt-6">
          {showSkeleton ? (
            <SummarySkeleton />
          ) : showError ? (
            <ErrorState
              message={
                error?.message ?? 'Check your connection and try again.'
              }
              onRetry={onRefresh}
              retrying={isRefetching}
            />
          ) : showEmpty ? (
            <EmptyState
              icon="📊"
              title="No activity yet"
              message="Record your first income or expense to see your numbers here."
              actionLabel="+ Add Income"
              onAction={() => navigation.navigate('AddIncome')}
            />
          ) : data ? (
            <>
              {data.source === 'local' ? (
                <Text className="mb-2 text-xs font-medium text-amber-700">
                  Showing offline figures from this device — pull to refresh when
                  back online.
                </Text>
              ) : null}
              <SummaryWidgets summary={data} />
            </>
          ) : null}
        </View>

        {/* Quick actions */}
        <View className="mt-6 flex-row" style={{gap: 12}}>
          <Button
            title={t('dashboard.business')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('Business')}
          />
          <Button
            title={t('dashboard.askAi')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('Assistant')}
          />
        </View>
        <Button
          title={t('dashboard.aiEntry')}
          className="mt-3"
          onPress={() => navigation.navigate('AITransaction')}
        />
        <Button
          title={t('dashboard.importSms')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('SmsImport')}
        />
        <View className="mt-3 flex-row" style={{gap: 12}}>
          <Button
            title={t('dashboard.income')}
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('AddIncome')}
          />
          <Button
            title={t('dashboard.expense')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('AddExpense')}
          />
        </View>
        <View className="mt-3 flex-row" style={{gap: 12}}>
          <Button
            title={t('dashboard.scanReceipt')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('ReceiptCapture')}
          />
          <Button
            title={t('dashboard.categorize')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('Categorize')}
          />
        </View>
        <View className="mt-3 flex-row" style={{gap: 12}}>
          <Button
            title={t('dashboard.dailySummary')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('DailySummary')}
          />
          <Button
            title={t('dashboard.customers')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('Customers')}
          />
        </View>
        <View className="mt-3 flex-row" style={{gap: 12}}>
          <Button
            title={t('dashboard.khata')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('KhataDashboard')}
          />
          <Button
            title={t('dashboard.reports')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('Reports')}
          />
        </View>
        <View className="mt-3 flex-row" style={{gap: 12}}>
          <Button
            title={t('dashboard.recurring')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('Recurring')}
          />
          <Button
            title={t('dashboard.cashCounter')}
            variant="secondary"
            className="flex-1"
            fullWidth={false}
            onPress={() => navigation.navigate('CashCounter')}
          />
        </View>

        {/* Recent activity */}
        <View className="mt-8 mb-2 flex-row items-center justify-between">
          <Text variant="label">{t('dashboard.recentActivity')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('TransactionHistory')}>
            <Text className="text-sm font-semibold text-primary">
              {t('dashboard.viewAll')}
            </Text>
          </Pressable>
        </View>
        {activity.length === 0 ? (
          <Text variant="caption">{t('dashboard.noTransactions')}</Text>
        ) : (
          <View style={{gap: 8}}>
            {activity.map(item => (
              <ActivityRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </View>
        )}

        <View className="mt-8">
          <Button
            title={t('common.logout')}
            variant="secondary"
            onPress={onLogout}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function ActivityRow({item}: {item: ActivityItem}): React.JSX.Element {
  const isIncome = item.kind === 'income';
  return (
    <View className="flex-row items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
      <View className="flex-1 pr-3">
        <Text className="font-semibold text-slate-900" numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="caption">{formatDisplayDate(item.date)}</Text>
      </View>
      <View className="items-end">
        <Text
          className={`font-semibold ${
            isIncome ? 'text-success' : 'text-danger'
          }`}>
          {isIncome ? '+' : '−'}
          {formatINR(item.amount)}
        </Text>
        {item.syncStatus !== 'synced' ? (
          <Text className="text-[10px] font-medium text-amber-600">
            {item.syncStatus === 'pending' ? 'Pending' : 'Failed'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
