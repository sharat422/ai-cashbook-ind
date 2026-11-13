import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import {useT} from '@/i18n';
import type {DailySummary} from '@features/daily-summary/domain/entities';
import {formatINR} from '@utils/currency';

/** Hero card: income, expense, and the day's profit/loss. */
export function ProfitHeroCard({
  summary,
}: {
  summary: DailySummary;
}): React.JSX.Element {
  const t = useT();
  const isProfit = summary.profit >= 0;
  return (
    <View className="rounded-3xl bg-slate-900 px-5 py-6">
      <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {t(isProfit ? 'daily.todayProfit' : 'daily.todayLoss')}
      </Text>
      <Text
        className={`mt-2 text-4xl font-bold ${
          isProfit ? 'text-green-300' : 'text-red-300'
        }`}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {isProfit ? '' : '−'}
        {formatINR(Math.abs(summary.profit))}
      </Text>

      <View className="mt-5 flex-row" style={{gap: 12}}>
        <View className="flex-1 rounded-2xl bg-white/5 p-3">
          <Text className="text-[11px] uppercase text-slate-400">{t('txn.typeIncome')}</Text>
          <Text className="mt-1 text-lg font-semibold text-white">
            {formatINR(summary.income)}
          </Text>
        </View>
        <View className="flex-1 rounded-2xl bg-white/5 p-3">
          <Text className="text-[11px] uppercase text-slate-400">{t('txn.typeExpense')}</Text>
          <Text className="mt-1 text-lg font-semibold text-white">
            {formatINR(summary.expense)}
          </Text>
        </View>
      </View>

      <Text className="mt-3 text-xs text-slate-500">
        {summary.transactionCount === 1
          ? t('daily.oneTransaction')
          : t('daily.transactions', {count: summary.transactionCount})}
        {summary.source === 'local' ? ` · ${t('daily.offlineFigures')}` : ''}
      </Text>
    </View>
  );
}
