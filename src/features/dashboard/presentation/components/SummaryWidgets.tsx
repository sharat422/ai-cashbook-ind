import React from 'react';
import {View} from 'react-native';

import type {DashboardSummary} from '@features/dashboard/domain/entities';
import {useT} from '@/i18n';
import {HeroBalanceCard} from './HeroBalanceCard';
import {SummaryCard} from './SummaryCard';

/**
 * The five dashboard widgets in their final layout: a hero Cash Balance, then
 * two rows pairing today's and monthly figures.
 */
export function SummaryWidgets({
  summary,
}: {
  summary: DashboardSummary;
}): React.JSX.Element {
  const t = useT();
  return (
    <View>
      <HeroBalanceCard
        label={t('dashboard.cashBalance')}
        balance={summary.cashBalance}
        caption={t('dashboard.cashBalanceCaption')}
      />

      <View className="mt-3 flex-row" style={{gap: 12}}>
        <SummaryCard
          label={t('dashboard.todayIncome')}
          amount={summary.todayIncome}
          icon="💰"
          accent="income"
        />
        <SummaryCard
          label={t('dashboard.todayExpense')}
          amount={summary.todayExpense}
          icon="🧾"
          accent="expense"
        />
      </View>

      <View className="mt-3 flex-row" style={{gap: 12}}>
        <SummaryCard
          label={t('dashboard.monthlyRevenue')}
          amount={summary.monthRevenue}
          icon="📈"
          accent="income"
        />
        <SummaryCard
          label={t('dashboard.monthlyExpense')}
          amount={summary.monthExpense}
          icon="📉"
          accent="expense"
        />
      </View>
    </View>
  );
}
