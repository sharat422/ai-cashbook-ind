import {useQueryClient} from '@tanstack/react-query';
import React, {useMemo, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, View} from 'react-native';

import {DateRangeField, FilterChip} from '@components/filters';
import {ErrorState, Screen, Text} from '@components/ui';
import {buildStatement} from '@features/customers/domain/customerStatement';
import {statementsRemote} from '@features/customers/data/statements.remote';
import {StatementDocument} from '@features/customers/presentation/components';
import {
  StatementConsentCard,
  consentKey,
} from '@features/customers/presentation/components/StatementConsentCard';
import {
  exportStatement,
  shareStatementLinkBySms,
  shareStatementOnWhatsApp,
  type ExportFormat,
} from '@features/customers/presentation/exportStatement';
import {useCustomerLedger} from '@features/customers/presentation/hooks';
import {useT, type TKey} from '@/i18n';
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

const PRESETS: Array<{labelKey: TKey; value: Preset}> = [
  {labelKey: 'customers.presetMonth', value: 'month'},
  {labelKey: 'customers.presetLastMonth', value: 'last-month'},
  {labelKey: 'customers.preset3Months', value: '3-months'},
  {labelKey: 'customers.presetAll', value: 'all'},
];

type ShareAction = ExportFormat | 'whatsapp' | 'sms' | 'print';

const EXPORTS: Array<{labelKey: TKey; value: ShareAction}> = [
  {labelKey: 'statement.pdf', value: 'pdf'},
  {labelKey: 'statement.excel', value: 'excel'},
  {labelKey: 'statement.print', value: 'print'},
  {labelKey: 'statement.whatsapp', value: 'whatsapp'},
  {labelKey: 'statement.sms', value: 'sms'},
];

/** Customer statement: pick a range, preview the document, export it. */
export function CustomerStatementScreen({
  route,
}: AppScreenProps<'CustomerStatement'>): React.JSX.Element {
  const t = useT();
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

  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  // "All" starts at 2000-01-01 on screen; the server reads no start as "all".
  const start = preset === 'all' ? undefined : from;
  const onAction = async (action: ShareAction) => {
    if (!statement) return;
    if (action === 'pdf' || action === 'excel') {
      exportStatement(action, customer, statement, businessName);
      return;
    }
    setBusy(true);
    try {
      if (action === 'print') {
        await statementsRemote.printLedger(customer.id, from, to);
      } else if (action === 'sms') {
        await shareStatementLinkBySms(customer, start);
      } else if (!(await shareStatementOnWhatsApp(customer, start))) {
        Alert.alert(t('statement.noConsentTitle'), t('statement.noConsentMsg', {name: customer.fullName}));
      }
    } catch (e) {
      Alert.alert(t('statement.printFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({queryKey: consentKey(customer.id)});
    }
  };

  const statement = useMemo(
    () => (ledger ? buildStatement(ledger, from, to) : null),
    [ledger, from, to],
  );

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('customers.statementTitle')}</Text>
        <Text variant="subtitle" className="mt-1">
          {customer.fullName}
          {customer.businessName ? ` · ${customer.businessName}` : ''}
        </Text>

        {/* Date range */}
        <Text variant="label" className="mt-5 mb-2">
          {t('customers.dateRange')}
        </Text>
        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {PRESETS.map(p => (
            <FilterChip
              key={p.value}
              label={t(p.labelKey)}
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
          {t('customers.export')}
        </Text>
        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {EXPORTS.map(ex => (
            <Pressable
              key={ex.value}
              accessibilityRole="button"
              disabled={!statement || busy}
              onPress={() => onAction(ex.value)}
              className={`h-11 items-center justify-center rounded-xl border border-border bg-white px-3 ${
                statement && !busy ? '' : 'opacity-50'
              }`}>
              <Text className="text-sm font-semibold text-slate-800">
                {t(ex.labelKey)}
              </Text>
            </Pressable>
          ))}
        </View>

        <StatementConsentCard customer={customer} />

        {/* Preview */}
        <Text variant="label" className="mt-6 mb-2">
          {t('customers.preview')}
        </Text>
        {isLoading && !ledger ? (
          <View className="py-10">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError && !ledger ? (
          <ErrorState
            message={error?.message ?? t('customers.loadStatementError')}
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
