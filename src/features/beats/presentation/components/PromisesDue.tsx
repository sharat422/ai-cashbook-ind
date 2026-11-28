import {useQuery} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {beatsRemote, type PromiseDue} from '@features/beats/data/beats.remote';
import {BEATS_KEY, useCollectOnBeat} from '@features/beats/presentation/hooks';
import {ReceivePaymentSheet} from '@features/customers/presentation/components/ReceivePaymentSheet';
import {useT} from '@/i18n';
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';

export interface PromiseRow {
  customerId: string;
  fullName: string;
  date: string;
  amount: number | null;
  remaining: number | null;
  overdue: boolean;
  beatName?: string;
}

/** "Promises due today": open promises to pay dated today or earlier (overdue ones
 *  flagged). Tapping one opens Receive payment for that shop. */
export function PromisesDueList({rows, onPress}: {rows: PromiseRow[]; onPress: (row: PromiseRow) => void}) {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <View testID="promises-due" className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4" style={{gap: 8}}>
      <Text className="text-sm font-semibold text-amber-900">{t('promises.title')} ({rows.length})</Text>
      {rows.map(p => (
        <Pressable key={p.customerId} testID={`promise-${p.customerId}`} accessibilityRole="button"
          onPress={() => onPress(p)} className="flex-row items-center justify-between rounded-xl bg-white px-3 py-2"
          style={{gap: 8}}>
          <View className="flex-1">
            <Text className="text-sm font-semibold">{p.fullName}</Text>
            <Text variant="caption">
              {[t('promises.byDate', {date: formatDisplayDate(p.date)}), p.beatName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-sm font-bold">{p.remaining != null ? formatINR(p.remaining) : t('promises.noAmount')}</Text>
            {p.amount != null && p.remaining != null && p.remaining < p.amount ? (
              <Text variant="caption">{t('promises.ofTotal', {total: formatINR(p.amount)})}</Text>
            ) : null}
            {p.overdue ? (
              <Text testID={`promise-overdue-${p.customerId}`} className="text-xs font-semibold text-red-600">
                {t('promises.overdue')}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
      <Text variant="caption">{t('promises.tapToCollect')}</Text>
    </View>
  );
}

/** Home screen: promises due today or overdue on every beat this person sees, each
 *  collected right here, on the promise's beat. Nothing due: nothing shown. */
export function PromisesDueCard(): React.JSX.Element | null {
  const t = useT();
  const canCollect = usePermissions().can(PERMISSIONS.ENTRY_CREATE);
  const due = useQuery({queryKey: [BEATS_KEY, 'promises-due'], queryFn: () => beatsRemote.promisesDue(),
    enabled: canCollect});
  const collect = useCollectOnBeat();
  const [paying, setPaying] = useState<PromiseDue | null>(null);
  const rows: PromiseDue[] = due.data ?? [];
  if (!canCollect || rows.length === 0) return null;
  return (
    <>
      <PromisesDueList rows={rows} onPress={row => setPaying(rows.find(r => r.customerId === row.customerId) ?? null)} />
      <ReceivePaymentSheet
        visible={paying !== null}
        outstanding={paying?.outstandingAmount ?? 0}
        submitting={collect.isPending}
        onClose={() => setPaying(null)}
        onSubmit={input => paying && collect.mutate(
          {customerId: paying.customerId, input: {...input, beatId: paying.beatId}},
          {onSuccess: () => setPaying(null), onError: err => Alert.alert(t('form.couldNotSave'), err.message)},
        )}
        customerId={paying?.customerId}
        dayBeatId={paying?.beatId}
        initialAmount={paying?.remaining ?? undefined}
      />
    </>
  );
}
