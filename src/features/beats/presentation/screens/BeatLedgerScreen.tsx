import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {RefreshControl, ScrollView, Text as RNText, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {beatsRemote, type Beat, type BeatLedgerEntry} from '@features/beats/data/beats.remote';
import {BEATS_KEY, useBeats} from '@features/beats/presentation/hooks';
import {useT} from '@/i18n';
import {paymentMethodLabel} from '@/i18n/labels';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

// Money in is green, money out dark. React Native's Text, not ours: our Text's variant
// colour (text-slate-900 / text-muted) comes later in the generated CSS and would win.
const tone = (e: BeatLedgerEntry) => (e.type === 'payment' ? 'text-green-700' : 'text-slate-900');

/**
 * One ledger per beat: that beat's credit and payment entries, newest first.
 * The beats come from the server, which gives staff only their own (and 403s
 * any other beat's ledger); owners and accountants get every beat.
 */
export function BeatLedgerScreen({route}: AppScreenProps<'BeatLedger'>): React.JSX.Element {
  const t = useT();
  const beats = useBeats();
  const [picked, setPicked] = useState(route.params?.beatId);
  const beatId = picked ?? beats.data?.[0]?.id;
  const ledger = useQuery<BeatLedgerEntry[]>({
    queryKey: [BEATS_KEY, 'ledger', beatId],
    queryFn: () => beatsRemote.ledger(beatId as string),
    enabled: !!beatId,
  });

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={ledger.isRefetching} onRefresh={ledger.refetch} />}>
        <Text variant="title">{t('beats.ledgerTitle')}</Text>
        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          {(beats.data ?? []).map((b: Beat) => (
            <FilterChip key={b.id} testID={`beat-${b.id}`} label={b.name} selected={b.id === beatId}
              onPress={() => setPicked(b.id)} />
          ))}
        </View>
        <View className="mt-5" style={{gap: 8}}>
          {beats.isLoading || ledger.isLoading ? (
            <Skeleton className="h-16 rounded-2xl" />
          ) : beats.isError || ledger.isError ? (
            <ErrorState onRetry={() => (beats.isError ? beats.refetch() : ledger.refetch())} />
          ) : !beatId ? (
            <EmptyState icon="🗺️" title={t('beats.noBeats')} message={t('beats.noBeatsMsg')} />
          ) : !ledger.data?.length ? (
            <EmptyState icon="📒" title={t('beats.ledgerEmpty')} message={t('beats.ledgerEmptyMsg')} />
          ) : (
            ledger.data.map((e: BeatLedgerEntry) => (
              <View key={e.id} testID="beat-ledger-row" className="flex-row items-center justify-between rounded-xl border border-border bg-white p-3">
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-semibold">{e.customerName}</Text>
                  <Text variant="caption">
                    {formatDisplayDate(e.date)}{' · '}
                    <RNText testID="beat-ledger-kind" className={`font-semibold ${tone(e)}`}>
                      {e.type === 'payment' ? t('ledger.paymentReceived') : t('ledger.creditGiven')}
                    </RNText>
                    {[e.invoiceNumber ? t('beats.ledgerInvoice', {number: e.invoiceNumber}) : '',
                      e.paymentMethod ? paymentMethodLabel(t, e.paymentMethod) : '',
                    ].filter(Boolean).map(part => ` · ${part}`).join('')}
                  </Text>
                </View>
                <RNText testID="beat-ledger-amount" className={`text-base font-bold ${tone(e)}`}>
                  {e.type === 'payment' ? '+ ' : '− '}{formatINR(e.amount)}
                </RNText>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
