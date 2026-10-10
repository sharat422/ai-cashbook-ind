import React, {useCallback, useMemo} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {Button, EmptyState, ErrorState, Icon, Screen, Text} from '@components/ui';
import type {IconName} from '@components/ui';
import {isSummaryEmpty} from '@features/dashboard/domain/entities';
import {
  StaffHome,
  SummarySkeleton,
  SummaryWidgets,
} from '@features/dashboard/presentation/components';
import {usePermissions} from '@features/auth/hooks';
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

interface QuickTile {
  icon: IconName;
  label: string;
  tint: string;
  fg: string;
  route: TileRoute;
}

/** Dashboard destinations reachable from the quick-action grid (all param-less). */
type TileRoute =
  | 'QuickAdd'
  | 'Business'
  | 'Assistant'
  | 'SmsImport'
  | 'ReceiptCapture'
  | 'Categorize'
  | 'DailySummary'
  | 'Customers'
  | 'KhataDashboard'
  | 'Reports'
  | 'Recurring'
  | 'CashCounter';

function QuickActionTile({
  tile,
  onPress,
}: {
  tile: QuickTile;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tile.label}
      onPress={onPress}
      className="items-center px-1 py-2.5"
      style={{width: '25%'}}>
      <View
        className={`h-[52px] w-[52px] items-center justify-center rounded-2xl ${tile.tint}`}>
        <Icon name={tile.icon} size={23} color={tile.fg} />
      </View>
      <Text
        className="mt-1.5 text-center text-[11px] font-medium text-slate-600"
        numberOfLines={2}>
        {tile.label}
      </Text>
    </Pressable>
  );
}

/**
 * Dashboard: 5 summary widgets (React Query) with pull-to-refresh, skeleton
 * loaders, empty + error states, plus quick actions and recent activity.
 */
export function DashboardScreen({
  navigation,
}: AppScreenProps<'Dashboard'>): React.JSX.Element {
  const t = useT();
  const {role} = usePermissions();
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

  const tiles: QuickTile[] = [
    {
      icon: 'plus',
      label: t('dashboard.addTransaction'),
      tint: 'bg-blue-50',
      fg: colors.primary,
      route: 'QuickAdd',
    },
    {
      icon: 'briefcase',
      label: t('dashboard.business'),
      tint: 'bg-slate-100',
      fg: '#475569',
      route: 'Business',
    },
    {
      icon: 'sparkles',
      label: t('dashboard.askAi'),
      tint: 'bg-violet-50',
      fg: '#7C3AED',
      route: 'Assistant',
    },
    {
      icon: 'message',
      label: t('dashboard.importSms'),
      tint: 'bg-green-50',
      fg: colors.success,
      route: 'SmsImport',
    },
    {
      icon: 'camera',
      label: t('dashboard.scanReceipt'),
      tint: 'bg-amber-50',
      fg: '#D97706',
      route: 'ReceiptCapture',
    },
    {
      icon: 'zap',
      label: t('dashboard.categorize'),
      tint: 'bg-orange-50',
      fg: '#EA580C',
      route: 'Categorize',
    },
    {
      icon: 'calendar',
      label: t('dashboard.dailySummary'),
      tint: 'bg-teal-50',
      fg: '#0D9488',
      route: 'DailySummary',
    },
    {
      icon: 'users',
      label: t('dashboard.customers'),
      tint: 'bg-indigo-50',
      fg: '#4F46E5',
      route: 'Customers',
    },
    {
      icon: 'book',
      label: t('dashboard.khata'),
      tint: 'bg-yellow-50',
      fg: '#CA8A04',
      route: 'KhataDashboard',
    },
    {
      icon: 'bar-chart',
      label: t('dashboard.reports'),
      tint: 'bg-sky-50',
      fg: '#0284C7',
      route: 'Reports',
    },
    {
      icon: 'refresh',
      label: t('dashboard.recurring'),
      tint: 'bg-slate-100',
      fg: colors.muted,
      route: 'Recurring',
    },
    {
      icon: 'coins',
      label: t('dashboard.cashCounter'),
      tint: 'bg-emerald-50',
      fg: '#059669',
      route: 'CashCounter',
    },
  ];

  // Staff are add-only: no dashboard, lists, reports or settings. Render a
  // focused home instead. (Hooks above still run — no conditional hooks.)
  if (role === 'staff') {
    return <StaffHome navigation={navigation} />;
  }

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
              <Icon name="bell" size={19} color={colors.text} />
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
              <Icon name="settings" size={19} color={colors.text} />
            </Pressable>
          </View>
        </View>
        {!online ? (
          <View className="mt-3 flex-row items-center rounded-xl bg-amber-50 px-3 py-2.5">
            <Icon name="wifi-off" size={16} color="#B45309" />
            <Text className="ml-2 flex-1 text-sm font-medium text-amber-700">
              {t('dashboard.offline')}
              {pendingCount > 0
                ? t('dashboard.pendingSyncSuffix', {count: pendingCount})
                : ''}
            </Text>
          </View>
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
              icon={
                <Icon name="bar-chart" size={44} color={colors.muted} />
              }
              title="No activity yet"
              message="Record your first income or expense to see your numbers here."
              actionLabel={t('dashboard.addTransaction')}
              onAction={() => navigation.navigate('QuickAdd', {type: 'income'})}
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

        {/* Hero: voice entry */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dashboard.aiEntry')}
          onPress={() => navigation.navigate('AITransaction')}
          className="mt-6 flex-row items-center rounded-2xl bg-primary px-4 py-3.5">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-white/20">
            <Icon name="mic" size={22} color="#FFFFFF" />
          </View>
          <Text className="ml-3 flex-1 text-base font-bold text-white">
            {t('dashboard.aiEntry')}
          </Text>
          <Icon name="chevron-right" size={20} color="#FFFFFF" />
        </Pressable>

        {/* Quick actions */}
        <View className="mt-6 rounded-2xl border border-border bg-white px-2 py-2">
          <View className="flex-row flex-wrap">
            {tiles.map(tile => (
              <QuickActionTile
                key={tile.route}
                tile={tile}
                onPress={() => navigation.navigate(tile.route)}
              />
            ))}
          </View>
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
      <View
        className={`mr-3 h-10 w-10 items-center justify-center rounded-full ${
          isIncome ? 'bg-green-50' : 'bg-red-50'
        }`}>
        <Icon
          name={isIncome ? 'coins' : 'receipt'}
          size={18}
          color={isIncome ? colors.success : colors.danger}
        />
      </View>
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
