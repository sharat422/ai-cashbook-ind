import React, {useState} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import type {Beat, BeatRetailer, VisitOutcome} from '@features/beats/data/beats.remote';
import {makeVisitClientId, useVisitQueue} from '@features/beats/data/visitQueue';
import {
  VisitOutcomeSheet,
  reasonLabel,
  type VisitOutcomeResult,
} from '@features/beats/presentation/components/VisitOutcomeSheet';
import {useCollectOnBeat, useDayList, useRecordVisit} from '@features/beats/presentation/hooks';
import type {Customer} from '@features/customers/domain/entities';
import {
  ReceivePaymentSheet,
  type ReceivePaymentInput,
} from '@features/customers/presentation/components/ReceivePaymentSheet';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

const OUTCOME_STYLE: Record<VisitOutcome, string> = {
  visited_ordered: 'bg-green-100 text-green-800',
  visited_no_order: 'bg-amber-100 text-amber-800',
  not_visited: 'bg-slate-200 text-slate-700',
};

/**
 * The salesperson's day: today's beat(s) in visit order with balance, overdue,
 * credit limit and last promise for each retailer. With a `beatId` (owner
 * opening one beat from the plan) it shows just that beat. The server only
 * returns beats this user may see; nothing is filtered here.
 */
/** The fields AddCredit reads, from what the day-list already has (staff
 *  can't load the full customer list). */
function asCustomer(r: BeatRetailer): Customer {
  return {
    id: r.customerId,
    fullName: r.fullName,
    businessName: r.businessName ?? undefined,
    mobile: '',
    outstandingAmount: r.outstandingAmount,
    isOverdue: r.overdueAmount > 0,
    creditLimit: r.creditLimit ?? undefined,
    createdAt: '',
  };
}

export function BeatDayListScreen({route, navigation}: AppScreenProps<'BeatDayList'>): React.JSX.Element {
  const t = useT();
  const beatId = route.params?.beatId;
  const query = useDayList(beatId);
  const record = useRecordVisit();
  const queued = useVisitQueue(s => s.pending);
  const [open, setOpen] = useState<{beatId: string; retailer: BeatRetailer} | null>(null);
  const collect = useCollectOnBeat();
  const [paying, setPaying] = useState<{beatId: string; retailer: BeatRetailer} | null>(null);

  const onCollect = (input: ReceivePaymentInput) => {
    if (!paying) return;
    collect.mutate(
      {customerId: paying.retailer.customerId, input: {...input, beatId: paying.beatId}},
      {
        onSuccess: () => setPaying(null),
        onError: err => Alert.alert(t('form.couldNotSave'), err.message),
      },
    );
  };

  const onSave = (result: VisitOutcomeResult) => {
    if (!open) return;
    record.mutate(
      {
        clientId: makeVisitClientId(),
        beatId: open.beatId,
        customerId: open.retailer.customerId,
        visitedAt: new Date().toISOString(),
        ...result,
      },
      {
        onSuccess: saved => {
          setOpen(null);
          if (!saved) Alert.alert(t('beats.savedOffline'));
        },
        onError: err => Alert.alert(t('form.couldNotSave'), err.message),
      },
    );
  };

  if (query.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-24 w-full" />
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen>
        <ErrorState onRetry={() => query.refetch()} retrying={query.isFetching} />
      </Screen>
    );
  }

  const beats: Beat[] = query.data ?? [];
  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
        }>
        <Text variant="title">{beatId ? beats[0]?.name : t('beats.todayTitle')}</Text>
        {beats.length === 0 ? (
          <EmptyState icon="🗺️" title={t('beats.noBeatToday')} message={t('beats.noBeatTodayMsg')} />
        ) : null}

        {beats.map(beat => (
          <View key={beat.id} className="mt-6">
            {!beatId ? <Text variant="label">{beat.name}</Text> : null}
            {beat.retailers.length === 0 ? (
              <Text variant="caption" className="mt-2">
                {t('beats.noRetailers')}
              </Text>
            ) : null}
            {beat.retailers.map((r, i) => {
              const pending = queued.find(
                v => v.beatId === beat.id && v.customerId === r.customerId,
              );
              const outcome = pending?.outcome ?? r.todayVisit?.outcome;
              const reason = pending?.reason ?? r.todayVisit?.reason;
              return (
                <Pressable
                  key={r.customerId}
                  testID={`retailer-${r.customerId}`}
                  accessibilityRole="button"
                  onPress={() => setOpen({beatId: beat.id, retailer: r})}
                  className="mt-3 rounded-2xl border border-border bg-white p-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 text-base font-semibold text-slate-900">
                      {i + 1}. {r.fullName}
                    </Text>
                    {outcome ? (
                      <Text className={`rounded-full px-2 py-0.5 text-xs ${OUTCOME_STYLE[outcome]}`}>
                        {t(`beats.outcome.${outcome}` as TKey)}
                        {pending ? ` · ${t('beats.pendingSync')}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  {r.businessName ? <Text variant="caption">{r.businessName}</Text> : null}
                  <View className="mt-3 flex-row flex-wrap" style={{rowGap: 6}}>
                    <Figure label={t('beats.balance')} value={formatINR(r.outstandingAmount)} />
                    <Figure
                      label={t('beats.overdue')}
                      value={formatINR(r.overdueAmount)}
                      alert={r.overdueAmount > 0}
                    />
                    <Figure
                      label={t('beats.creditLimit')}
                      value={r.creditLimit != null ? formatINR(r.creditLimit) : t('beats.noLimit')}
                      alert={r.creditLimit != null && r.outstandingAmount > r.creditLimit}
                    />
                    <Figure
                      label={t('beats.lastPromise')}
                      value={r.lastPromiseDate ? formatDisplayDate(r.lastPromiseDate) : '—'}
                    />
                  </View>
                  {reason ? (
                    <Text variant="caption" className="mt-2">
                      {reasonLabel(t, reason)}
                    </Text>
                  ) : null}
                  <View className="mt-3 flex-row" style={{gap: 8}}>
                    <Pressable
                      testID={`collect-${r.customerId}`}
                      accessibilityRole="button"
                      onPress={() => setPaying({beatId: beat.id, retailer: r})}
                      className="flex-1 items-center rounded-xl bg-green-50 py-2">
                      <Text className="text-sm font-semibold text-green-800">
                        {t('beats.collect')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        navigation.navigate('AddCredit', {customer: asCustomer(r), beatId: beat.id})
                      }
                      className="flex-1 items-center rounded-xl bg-slate-100 py-2">
                      <Text className="text-sm font-semibold text-slate-800">
                        {t('beats.giveCredit')}
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <VisitOutcomeSheet
        visible={open !== null}
        retailerName={open?.retailer.fullName ?? ''}
        hasDues={(open?.retailer.outstandingAmount ?? 0) > 0}
        saving={record.isPending}
        onClose={() => setOpen(null)}
        onSave={onSave}
      />
      <ReceivePaymentSheet
        visible={paying !== null}
        outstanding={paying?.retailer.outstandingAmount ?? 0}
        submitting={collect.isPending}
        onClose={() => setPaying(null)}
        onSubmit={onCollect}
      />
    </Screen>
  );
}

function Figure({label, value, alert}: {label: string; value: string; alert?: boolean}) {
  return (
    <View className="w-1/2">
      <Text variant="caption">{label}</Text>
      <Text className={`text-sm font-semibold ${alert ? 'text-red-600' : 'text-slate-900'}`}>
        {value}
      </Text>
    </View>
  );
}
