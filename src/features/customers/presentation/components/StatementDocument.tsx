import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';
import type {CustomerStatement} from '@features/customers/domain/customerStatement';
import type {Customer} from '@features/customers/domain/entities';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

interface Props {
  customer: Customer;
  statement: CustomerStatement;
  /** Issuing business name (header). */
  businessName?: string;
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}): React.JSX.Element {
  return (
    <View className="flex-1 rounded-xl bg-slate-50 p-3">
      <Text className="text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text className={`mt-1 text-sm font-bold ${accent}`} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function BalanceRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className={`text-sm ${bold ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
        {label}
      </Text>
      <Text className={`text-sm ${bold ? 'font-bold text-slate-900' : 'text-slate-800'}`}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Beautiful, PDF-ready statement of account. A clean white "paper" card —
 * mobile-first but laid out like a printed document (header → parties → summary
 * → balances → transaction table → footer).
 */
export function StatementDocument({
  customer,
  statement,
  businessName,
}: Props): React.JSX.Element {
  return (
    <View
      className="rounded-2xl border border-border bg-white p-5"
      style={{
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: {width: 0, height: 6},
        elevation: 2,
      }}>
      {/* Header */}
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-lg font-bold text-slate-900">
            {businessName || 'Statement of Account'}
          </Text>
          <Text className="text-xs text-muted">Statement of Account</Text>
        </View>
        <View className="rounded-lg bg-slate-900 px-3 py-1.5">
          <Text className="text-[11px] font-semibold text-white">
            {formatINR(statement.outstanding)}
          </Text>
          <Text className="text-[9px] uppercase text-slate-400">due</Text>
        </View>
      </View>

      <View className="my-4 h-px bg-border" />

      {/* Parties + period */}
      <View className="flex-row justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-[10px] uppercase text-muted">Billed to</Text>
          <Text className="mt-0.5 text-sm font-semibold text-slate-900">
            {customer.fullName}
          </Text>
          {customer.businessName ? (
            <Text className="text-xs text-slate-600">{customer.businessName}</Text>
          ) : null}
          <Text className="text-xs text-slate-600">+91 {customer.mobile}</Text>
          {customer.gstNumber ? (
            <Text className="text-xs text-slate-600">GSTIN: {customer.gstNumber}</Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text className="text-[10px] uppercase text-muted">Period</Text>
          <Text className="mt-0.5 text-xs font-medium text-slate-900">
            {formatDisplayDate(statement.from)}
          </Text>
          <Text className="text-xs text-muted">to</Text>
          <Text className="text-xs font-medium text-slate-900">
            {formatDisplayDate(statement.to)}
          </Text>
        </View>
      </View>

      {/* Summary cards */}
      <View className="mt-4 flex-row" style={{gap: 8}}>
        <SummaryTile
          label="Total Credit"
          value={formatINR(statement.totalCredit)}
          accent="text-amber-700"
        />
        <SummaryTile
          label="Total Received"
          value={formatINR(statement.totalPayment)}
          accent="text-success"
        />
        <SummaryTile
          label="Outstanding"
          value={formatINR(statement.outstanding)}
          accent="text-slate-900"
        />
      </View>

      {/* Balances */}
      <View className="mt-4 rounded-xl border border-border px-3 py-1">
        <BalanceRow
          label="Opening balance"
          value={formatINR(statement.openingBalance)}
        />
        <View className="h-px bg-border" />
        <BalanceRow
          label="Closing balance"
          value={formatINR(statement.closingBalance)}
          bold
        />
      </View>

      {/* Transactions table */}
      <Text className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Transactions
      </Text>
      <View className="flex-row border-b border-slate-200 pb-1.5">
        <Text className="flex-[2] text-[11px] font-semibold text-muted">Date</Text>
        <Text className="flex-[1.4] text-[11px] font-semibold text-muted">Type</Text>
        <Text className="flex-[1.6] text-right text-[11px] font-semibold text-muted">
          Amount
        </Text>
        <Text className="flex-[1.6] text-right text-[11px] font-semibold text-muted">
          Balance
        </Text>
      </View>

      {statement.rows.length === 0 ? (
        <Text variant="caption" className="py-4 text-center">
          No transactions in this period.
        </Text>
      ) : (
        statement.rows.map(e => {
          const isCredit = e.type === 'credit';
          return (
            <View
              key={e.id}
              className="flex-row items-center border-b border-slate-100 py-2">
              <Text className="flex-[2] text-xs text-slate-700">
                {formatDisplayDate(e.date)}
              </Text>
              <Text className="flex-[1.4] text-xs text-slate-700">
                {isCredit ? 'Credit' : 'Payment'}
              </Text>
              <Text
                className={`flex-[1.6] text-right text-xs font-semibold ${
                  isCredit ? 'text-amber-700' : 'text-success'
                }`}>
                {isCredit ? '+' : '−'}
                {formatINR(e.amount)}
              </Text>
              <Text className="flex-[1.6] text-right text-xs font-medium text-slate-900">
                {formatINR(e.balance)}
              </Text>
            </View>
          );
        })
      )}

      {/* Footer */}
      <View className="mt-4 flex-row items-center justify-between">
        <Text className="text-[10px] text-muted">
          Generated by Smart CashBook
        </Text>
        <Text className="text-[10px] text-muted">
          {formatDisplayDate(statement.to)}
        </Text>
      </View>
    </View>
  );
}
