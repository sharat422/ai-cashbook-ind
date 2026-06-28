import React from 'react';
import {View} from 'react-native';

import type {DashboardSummary} from '@features/dashboard/domain/entities';
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
  return (
    <View>
      <HeroBalanceCard
        balance={summary.cashBalance}
        caption="Income received minus expenses paid"
      />

      <View className="mt-3 flex-row" style={{gap: 12}}>
        <SummaryCard
          label="Today's Income"
          amount={summary.todayIncome}
          icon="💰"
          accent="income"
        />
        <SummaryCard
          label="Today's Expense"
          amount={summary.todayExpense}
          icon="🧾"
          accent="expense"
        />
      </View>

      <View className="mt-3 flex-row" style={{gap: 12}}>
        <SummaryCard
          label="Monthly Revenue"
          amount={summary.monthRevenue}
          icon="📈"
          accent="income"
        />
        <SummaryCard
          label="Monthly Expense"
          amount={summary.monthExpense}
          icon="📉"
          accent="expense"
        />
      </View>
    </View>
  );
}
