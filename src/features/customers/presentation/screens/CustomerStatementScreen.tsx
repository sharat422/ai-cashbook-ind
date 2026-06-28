import React, {useMemo, useState} from 'react';
import {ActivityIndicator, Pressable, View} from 'react-native';

import {DateRangeField, FilterChip} from '@components/filters';
import {ErrorState, Screen, Text} from '@components/ui';
import {buildStatement} from '@features/customers/domain/customerStatement';
import {StatementDocument} from '@features/customers/presentation/components';
import {exportStatement, type ExportFormat} from '@features/customers/presentation/exportStatement';
import {useCustomerLedger} from '@features/customers/presentation/hooks';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {colors} from '@theme/colors';
import {toISODate} from '@utils/date';

type Preset = 'month' | 'last-month' | '3-months' | 'all';

function presetRange(preset: Preset): {from: string; to: string} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = toISODate(now);
  switch (preset) {
    case 'month':
      return {from: toISODate(new Date(y, m, 1)), to: today};
    case 'last-month':
      return {
        from: toISODate(new Date(y, m - 1, 1)),
        to: toISODate(new Date(y, m, 0)),
      };
    case '3-months':
      return {from: toISODate(new Date(y, m - 2, 1)), to: today};
    case 'all':
      return {from: '2000-01-01', to: today};
  }
}

const PRESETS: Array<{label: string; value: Preset}> = [
  {label: 'This month', value: 'month'},
  {label: 'Last month', value: 'last-month'},
  {label: '3 months', value: '3-months'},
  {label: 'All', value: 'all'},
];

const EXPORTS: Array<{label: string; value: ExportFormat}> = [
  {label: '📄 PDF', value: 'pdf'},
  {label: '📊 Excel', value: 'excel'},
  {label: '🟢 WhatsApp', value: 'whatsapp'},
];

/** Customer statement: pick a range, preview the document, export it. */
export function CustomerStatementScreen({
  route,
}: AppScreenProps<'CustomerStatement'>): React.JSX.Element {
  const {customer} = route.params;
  const businessName = useAuthStore(s => s.business?.businessName);
  const {data: ledger, isLoading, isError, error, refetch} = useCustomerLedger(
    customer.id,
  );

  const [preset, setPreset] = useState<Preset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const range = presetRange(p);
    setFrom(range.from);
    setTo(range.to);
  };

  const statement = useMemo(
    () => (ledger ? buildStatement(ledger, from, to) : null),
    [ledger, from, to],
  );

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">Statement</Text>
        <Text variant="subtitle" className="mt-1">
          {customer.fullName}
          {customer.businessName ? ` · ${customer.businessName}` : ''}
        </Text>

        {/* Date range */}
        <Text variant="label" className="mt-5 mb-2">
          Date range
        </Text>
        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {PRESETS.map(p => (
            <FilterChip
              key={p.value}
              label={p.label}
              selected={preset === p.value}
              onPress={() => applyPreset(p.value)}
            />
          ))}
        </View>
        <View className="mt-3">
          <DateRangeField
            from={from}
            to={to}
            onChange={({from: f, to: t}) => {
              if (f) setFrom(f);
              if (t) setTo(t);
            }}
          />
        </View>

        {/* Export options */}
        <Text variant="label" className="mt-5 mb-2">
          Export
        </Text>
        <View className="flex-row" style={{gap: 8}}>
          {EXPORTS.map(ex => (
            <Pressable
              key={ex.value}
              accessibilityRole="button"
              disabled={!statement}
              onPress={() =>
                statement &&
                exportStatement(ex.value, customer, statement, businessName)
              }
              className={`h-11 flex-1 items-center justify-center rounded-xl border border-border bg-white ${
                statement ? '' : 'opacity-50'
              }`}>
              <Text className="text-sm font-semibold text-slate-800">
                {ex.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Preview */}
        <Text variant="label" className="mt-6 mb-2">
          Preview
        </Text>
        {isLoading && !ledger ? (
          <View className="py-10">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError && !ledger ? (
          <ErrorState
            message={error?.message ?? 'Could not load the statement.'}
            onRetry={refetch}
          />
        ) : statement ? (
          <StatementDocument
            customer={customer}
            statement={statement}
            businessName={businessName}
          />
        ) : null}
      </View>
    </Screen>
  );
}
