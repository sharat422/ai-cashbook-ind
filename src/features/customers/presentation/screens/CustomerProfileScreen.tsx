import React, {useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  View,
} from 'react-native';

import {FilterChip} from '@components/filters';
import {
  Avatar,
  EmptyState,
  ErrorState,
  Screen,
  SuccessOverlay,
  Text,
} from '@components/ui';
import type {LedgerEntryView} from '@features/customers/domain/ledger';
import {
  ReceivePaymentSheet,
  RiskInsightCard,
  StatusBadge,
  TimelineItem,
  type ReceivePaymentInput,
} from '@features/customers/presentation/components';
import {STATUS_STYLE} from '@features/customers/presentation/components/statusStyle';
import {
  useCustomerLedger,
  useLedgerMutations,
  useRiskPrediction,
} from '@features/customers/presentation/hooks';
import {useConnectivity} from '@features/income/presentation/hooks';
import {SendReminderSheet} from '@features/reminders/presentation/components';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {colors} from '@theme/colors';
import {formatINR} from '@utils/currency';

type Filter = 'all' | 'credit' | 'payment';

const FILTERS: Array<{label: string; value: Filter}> = [
  {label: 'All', value: 'all'},
  {label: 'Credit', value: 'credit'},
  {label: 'Payments', value: 'payment'},
];

export function CustomerProfileScreen({
  navigation,
  route,
}: AppScreenProps<'CustomerProfile'>): React.JSX.Element {
  const {customer} = route.params;
  const ledgerQuery = useCustomerLedger(customer.id);
  const {receivePayment} = useLedgerMutations(customer.id);
  const online = useConnectivity();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const businessName = useAuthStore(s => s.business?.businessName);

  const ledger = ledgerQuery.data;
  const outstanding = ledger?.outstanding ?? customer.outstandingAmount;
  const status =
    outstanding <= 0 ? 'no-dues' : customer.isOverdue ? 'overdue' : 'pending';
  const style = STATUS_STYLE[status];

  const entries = useMemo<LedgerEntryView[]>(() => {
    const all: LedgerEntryView[] = ledger?.entries ?? [];
    return filter === 'all' ? all : all.filter(e => e.type === filter);
  }, [ledger, filter]);

  const risk = useRiskPrediction(customer, ledger);

  const daysOverdue =
    customer.isOverdue && customer.lastTransactionDate
      ? Math.max(
          0,
          Math.round(
            (Date.now() - new Date(customer.lastTransactionDate).getTime()) /
              86_400_000,
          ),
        )
      : 0;
  const relationshipScore = risk ? 100 - risk.prediction.score : 60;

  const onReceivePayment = (input: ReceivePaymentInput) => {
    receivePayment.mutate(input, {
      onSuccess: () => {
        setPaymentOpen(false);
        setPaidAmount(input.amount);
      },
      onError: err => Alert.alert('Could not save', err.message),
    });
  };

  const ListHeader = (
    <View className="pb-2 pt-6">
      {/* Customer information */}
      <View className="items-center">
        <Avatar name={customer.fullName} size={84} />
        <Text variant="title" className="mt-3 text-center">
          {customer.fullName}
        </Text>
        {customer.businessName ? (
          <Text variant="subtitle" className="mt-0.5">
            {customer.businessName}
          </Text>
        ) : null}
        <View className="mt-2">
          <StatusBadge status={status} />
        </View>
      </View>

      {/* Outstanding balance hero */}
      <View className="mt-6 rounded-3xl bg-slate-900 px-5 py-6">
        <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Outstanding balance
        </Text>
        <Text
          className={`mt-2 text-4xl font-bold ${
            status === 'no-dues' ? 'text-white' : style.amount
          }`}
          numberOfLines={1}
          adjustsFontSizeToFit>
          {formatINR(Math.max(outstanding, 0))}
        </Text>
        <View className="mt-4 flex-row" style={{gap: 12}}>
          <View className="flex-1 rounded-2xl bg-white/5 p-3">
            <Text className="text-[11px] uppercase text-slate-400">
              Credit history
            </Text>
            <Text className="mt-1 text-base font-semibold text-amber-300">
              {formatINR(ledger?.totalCredit ?? 0)}
            </Text>
          </View>
          <View className="flex-1 rounded-2xl bg-white/5 p-3">
            <Text className="text-[11px] uppercase text-slate-400">
              Payment history
            </Text>
            <Text className="mt-1 text-base font-semibold text-green-300">
              {formatINR(ledger?.totalPayment ?? 0)}
            </Text>
          </View>
        </View>
      </View>

      {/* Primary actions */}
      <View className="mt-5 flex-row" style={{gap: 12}}>
        <ActionButton
          label="Add credit"
          tone="credit"
          onPress={() => navigation.navigate('AddCredit', {customer})}
        />
        <ActionButton
          label="Receive payment"
          tone="payment"
          onPress={() => setPaymentOpen(true)}
        />
      </View>

      {/* Secondary actions */}
      <View className="mt-3 flex-row flex-wrap" style={{gap: 8}}>
        <SecondaryAction
          label="🔔 Reminder"
          onPress={() => setReminderOpen(true)}
        />
        <SecondaryAction
          label="📄 Statement"
          onPress={() => navigation.navigate('CustomerStatement', {customer})}
        />
        <SecondaryAction
          label="🤝 Collect"
          onPress={() =>
            navigation.navigate('CollectionAssistant', {
              name: customer.fullName,
              mobile: customer.mobile,
              amount: Math.max(outstanding, 0),
              daysOverdue,
              relationshipScore,
            })
          }
        />
        <SecondaryAction
          label="✏️ Edit"
          onPress={() => navigation.navigate('CustomerForm', {customer})}
        />
        <SecondaryAction
          label="📞 Call"
          onPress={() => Linking.openURL(`tel:${customer.mobile}`)}
        />
      </View>

      {/* Contact details */}
      <View className="mt-6 rounded-2xl border border-border bg-white px-4">
        <Detail label="Mobile" value={`+91 ${customer.mobile}`} />
        <Detail label="GST number" value={customer.gstNumber} />
        <Detail label="Address" value={customer.address} />
        <Detail label="Notes" value={customer.notes} />
      </View>

      {/* AI payment-risk insight */}
      {risk ? (
        <View className="mt-6">
          <RiskInsightCard
            prediction={risk.prediction}
            features={risk.features}
          />
        </View>
      ) : null}

      {/* Timeline header + filters */}
      <View className="mt-7 flex-row items-center justify-between">
        <Text variant="label">Transaction timeline</Text>
        <Text variant="caption">
          {ledger ? `${ledger.entries.length} entries` : ''}
        </Text>
      </View>
      <View className="mt-3 flex-row" style={{gap: 8}}>
        {FILTERS.map(f => (
          <FilterChip
            key={f.value}
            label={f.label}
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
          />
        ))}
      </View>
      <View className="h-3" />
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={item => item.id}
        renderItem={({item, index}) => (
          <TimelineItem entry={item} isLast={index === entries.length - 1} />
        )}
        ListHeaderComponent={ListHeader}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 32}}
        ListEmptyComponent={
          ledgerQuery.isLoading ? (
            <View className="py-10">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : ledgerQuery.isError ? (
            <ErrorState
              message={ledgerQuery.error?.message ?? 'Could not load activity.'}
              onRetry={ledgerQuery.refetch}
            />
          ) : (
            <EmptyState
              icon="🧾"
              title="No transactions yet"
              message="Add a credit or record a payment to start the timeline."
            />
          )
        }
      />

      <ReceivePaymentSheet
        visible={paymentOpen}
        outstanding={Math.max(outstanding, 0)}
        submitting={receivePayment.isPending}
        offline={!online}
        onClose={() => setPaymentOpen(false)}
        onSubmit={onReceivePayment}
      />

      <SuccessOverlay
        visible={paidAmount !== null}
        confetti
        holdMs={2200}
        title={`${formatINR(paidAmount ?? 0)} received`}
        subtitle={online ? 'Payment recorded' : 'Saved — will sync when online'}
        onDone={() => setPaidAmount(null)}
      />

      <SendReminderSheet
        visible={reminderOpen}
        customer={customer}
        outstanding={Math.max(outstanding, 0)}
        businessName={businessName}
        onClose={() => setReminderOpen(false)}
      />
    </Screen>
  );
}

function ActionButton({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: 'credit' | 'payment';
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`h-12 flex-1 items-center justify-center rounded-xl ${
        tone === 'credit' ? 'bg-amber-500' : 'bg-success'
      }`}>
      <Text className="text-sm font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

function SecondaryAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="rounded-full border border-border bg-white px-3.5 py-2">
      <Text className="text-sm font-medium text-slate-700">{label}</Text>
    </Pressable>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value?: string;
}): React.JSX.Element | null {
  if (!value) return null;
  return (
    <View className="py-3">
      <Text variant="caption">{label}</Text>
      <Text className="mt-0.5 text-base text-slate-900">{value}</Text>
    </View>
  );
}
