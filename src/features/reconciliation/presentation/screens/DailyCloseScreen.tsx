import {personLabel} from '@utils/personLabel';
import React, {useState} from 'react';
import {Alert, RefreshControl, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField} from '@components/form';
import {Button, EmptyState, ErrorState, Input, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import type {Beat} from '@features/beats/data/beats.remote';
import {useBeats} from '@features/beats/presentation/hooks';
import {reconciliationRemote, type CashDeposit, type DailyClose} from '@features/reconciliation/data/reconciliation.remote';
import {formatMoney, isZero} from '@features/reconciliation/domain/money';
import {useDailyClose} from '@features/reconciliation/presentation/hooks';
import {useT} from '@/i18n';
import {paymentMethodLabel} from '@/i18n/labels';
import type {AppScreenProps} from '@navigation/types';
import {todayIST} from '@utils/date';
import {useAuthStore} from '@store/auth.store';

/**
 * Per beat and day: what was collected, how (cash / UPI / bank), credit given,
 * and the difference still to explain: non-cash collections not yet matched
 * to a bank line, and cash not yet deposited (and matched) or kept back.
 * ₹0.00 means every rupee is in the bank or recorded as kept back.
 * The server decides which beats a caller may see; staff get only their own.
 */
export function DailyCloseScreen({navigation, route}: AppScreenProps<'DailyClose'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const seesAll = can(PERMISSIONS.DATA_VIEW);
  const beatsQuery = useBeats();
  const beats: Beat[] = beatsQuery.data ?? [];
  const [picked, setPicked] = useState<string | undefined>(route.params?.beatId);
  const [date, setDate] = useState(todayIST());
  // Staff have no whole-business view, so they always look at one of their beats.
  const beatId = picked ?? (seesAll ? undefined : beats[0]?.id);
  const close = useDailyClose(date, beatId, seesAll || beatId !== undefined);
  const data: DailyClose | undefined = close.data;
  const canCount = !can(PERMISSIONS.DATA_VIEW) || can(PERMISSIONS.ENTRY_EDIT); // staff and owner, not read-only
  const [counted, setCounted] = useState('');
  const [saving, setSaving] = useState(false);
  const me = useAuthStore(s => s.user?.id);
  /** Per-salesperson counts being typed, by user id (pre-filled with their cash recorded). */
  const [personCounted, setPersonCounted] = useState<Record<string, string>>({});
  const memberName = (uid: string) => {
    const m = (data?.members ?? []).find(x => x.userId === uid);
    return m ? personLabel(m.name, m.mobile) : '';
  };
  const overShortLabel = (v: string) =>
    Number(v) < 0 ? t('close.short') : Number(v) > 0 ? t('close.over') : t('close.countMatches');
  const absMoney = (v: string) => formatMoney(Math.abs(Number(v)).toFixed(2));
  /** No user: the whole beat (or business). A user: that salesperson's own cash. */
  const saveCount = async (userId?: string, value?: string) => {
    setSaving(true);
    try {
      await reconciliationRemote.cashCount(date, beatId, value ?? counted, userId);
      if (userId) {
        setPersonCounted(({[userId]: _saved, ...rest}) => rest);
      } else {
        setCounted('');
      }
      await close.refetch();
    } catch (e) {
      Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setSaving(false);
    }
  };

  // Owner: record cash taken to the bank, or kept back in the shop.
  const canDeposit = can(PERMISSIONS.ENTRY_EDIT);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositKind, setDepositKind] = useState<CashDeposit['kind']>('deposit');
  /** Per-salesperson deposits being typed, by user id (pre-filled with their counted cash). */
  const [personDeposit, setPersonDeposit] = useState<Record<string, string>>({});
  /** No user: the whole beat. A user: that salesperson's cash taken to the bank. */
  const saveDeposit = async (userId?: string, amount?: string) => {
    setSaving(true);
    try {
      await reconciliationRemote.recordDeposit(date, beatId, amount ?? depositAmount, userId ? 'deposit' : depositKind, userId);
      if (userId) {
        setPersonDeposit(({[userId]: _saved, ...rest}) => rest);
      } else {
        setDepositAmount('');
      }
      await close.refetch();
    } catch (e) {
      Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setSaving(false);
    }
  };
  const removeDeposit = (d: CashDeposit) =>
    Alert.alert(t('deposit.removeTitle'), t('deposit.removeMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('deposit.remove'), style: 'destructive', onPress: async () => {
        try {
          await reconciliationRemote.deleteDeposit(d.id);
          await close.refetch();
        } catch (e) {
          Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
        }
      }},
    ]);

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{paddingVertical: 24, paddingBottom: 40}}
        refreshControl={<RefreshControl refreshing={close.isRefetching} onRefresh={() => close.refetch()} />}>
        <Text variant="title">{t('close.title')}</Text>
        <View className="mt-4 flex-row flex-wrap" style={{gap: 8}}>
          {seesAll ? (
            <FilterChip label={t('close.allBeats')} selected={beatId === undefined} onPress={() => setPicked(undefined)} />
          ) : null}
          {beats.map(b => (
            <FilterChip key={b.id} label={b.name} selected={beatId === b.id} onPress={() => setPicked(b.id)} />
          ))}
        </View>
        <View className="mt-3">
          <DateField value={date} onChange={setDate} />
        </View>

        {!seesAll && !beatsQuery.isLoading && beats.length === 0 ? (
          <EmptyState icon="🗺️" title={t('close.noBeat')} message={t('close.noBeatMsg')} />
        ) : close.isLoading || beatsQuery.isLoading ? (
          <Skeleton className="mt-6 h-40 w-full" />
        ) : close.isError ? (
          <ErrorState onRetry={() => close.refetch()} retrying={close.isFetching} />
        ) : data ? (
          <>
            <View className="mt-6 rounded-2xl border border-border bg-white p-4" style={{gap: 10}}>
              <Row
                label={t('close.recorded', {count: data.collections.length})}
                value={formatMoney(data.creditCollected)}
                bold
              />
              <Row label={t('close.cashInHand')} value={formatMoney(data.cashInHand)} />
              <Row label={t('close.upiClaimed')} value={formatMoney(data.upiClaimed)} />
              <Row label={t('close.bankClaimed')} value={formatMoney(data.bankClaimed)} />
              {!isZero(data.otherClaimed) ? (
                <Row label={t('close.otherClaimed')} value={formatMoney(data.otherClaimed)} />
              ) : null}
              <Row label={t('close.verified')} value={formatMoney(data.verified)} />
              {data.cashDeposited != null ? ( // older servers don't send it
                <Row label={t('close.cashDeposited')} value={formatMoney(data.cashDeposited)} />
              ) : null}
              {data.cashDepositPending && !isZero(data.cashDepositPending) ? (
                <Row label={t('close.depositPending')} value={formatMoney(data.cashDepositPending)} />
              ) : null}
              {data.cashKeptBack && !isZero(data.cashKeptBack) ? (
                <Row label={t('close.keptBack')} value={formatMoney(data.cashKeptBack)} />
              ) : null}
              <Row label={t('close.creditGiven')} value={formatMoney(data.creditGiven)} />
            </View>
            <View
              testID="close-difference"
              className={`mt-3 rounded-2xl p-4 ${isZero(data.difference) ? 'bg-green-50' : 'bg-red-50'}`}>
              <Row label={t('close.difference')} value={formatMoney(data.difference)} bold />
              <Text variant="caption" className="mt-1">
                {isZero(data.difference) ? t('close.allMatched') : t('close.differenceHint')}
              </Text>
            </View>

            {(data.members ?? []).length > 1 ? (
              <View testID="close-members" className="mt-3 rounded-2xl border border-border bg-white p-4" style={{gap: 6}}>
                <Text className="text-sm font-semibold">{t('close.byMember')}</Text>
                {(data.members ?? []).map(m => (
                  <Row key={m.userId ?? 'none'} label={personLabel(m.name, m.mobile)}
                    value={`${formatMoney(m.collected)} · ${t('close.cash')} ${formatMoney(m.cash)}`} />
                ))}
              </View>
            ) : null}

            {/* Counted cash: compared with the cash recorded, never used to change a sale. */}
            <View testID="cash-count" className="mt-3 rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
              <Text className="text-sm font-semibold">{t('close.countHeading')}</Text>
              {data.cashCounted != null ? ( // older servers don't send it
                <>
                  <Row label={t('close.cashCounted')} value={formatMoney(data.cashCounted)} />
                  {data.cashOverShort != null ? (
                    <Row label={overShortLabel(data.cashOverShort)} value={absMoney(data.cashOverShort)} bold />
                  ) : (
                    <Text variant="caption">{t('close.countIncomplete')}</Text>
                  )}
                </>
              ) : (
                <Text variant="caption">{t('close.countHint')}</Text>
              )}

              {/* One row per salesperson on a beat: their own cash, pre-filled with what they recorded.
                  Staff count only their own. */}
              {beatId ? (data.members ?? []).filter(m => m.userId && (seesAll || m.userId === me)).map(m => {
                const uid = m.userId as string;
                return (
                  <View key={uid} testID={`count-person-${uid}`} className="mt-2 border-t border-border pt-2" style={{gap: 6}}>
                    <Row label={personLabel(m.name, m.mobile)} value={`${t('close.cash')} ${formatMoney(m.cash)}`} />
                    {m.cashCounted != null && m.cashOverShort != null ? (
                      <Row label={`${t('close.cashCounted')} ${formatMoney(m.cashCounted)} · ${overShortLabel(m.cashOverShort)}`}
                        value={absMoney(m.cashOverShort)} />
                    ) : null}
                    {m.cashDeposited && !isZero(m.cashDeposited) ? (
                      <Row label={t('close.cashDeposited')} value={formatMoney(m.cashDeposited)} />
                    ) : null}
                    {canCount ? (
                      <View className="flex-row items-center" style={{gap: 8}}>
                        <View className="flex-1">
                          <Input testID={`count-person-input-${uid}`} keyboardType="decimal-pad"
                            value={personCounted[uid] ?? m.cashCounted ?? m.cash}
                            onChangeText={v => setPersonCounted(c => ({...c, [uid]: v.replace(/[^0-9.]/g, '')}))} />
                        </View>
                        <Button testID={`count-person-save-${uid}`} title={t('close.saveCount')} variant="secondary"
                          disabled={saving || personCounted[uid] === ''}
                          onPress={() => saveCount(uid, personCounted[uid] ?? m.cashCounted ?? m.cash)} />
                      </View>
                    ) : null}
                  </View>
                );
              }) : null}

              {canCount ? (
                <>
                  {beatId && (data.members ?? []).some(m => m.userId) ? (
                    <Text variant="caption" className="mt-2">{t('close.wholeBeat')}</Text>
                  ) : null}
                  <Input testID="cash-count-input" placeholder={t('close.countPlaceholder')} keyboardType="decimal-pad"
                    value={counted} onChangeText={v => setCounted(v.replace(/[^0-9.]/g, ''))} />
                  <Button testID="cash-count-save" title={t('close.saveCount')} variant="secondary" loading={saving}
                    disabled={!counted || saving} onPress={() => saveCount()} />
                </>
              ) : null}
              <Text variant="caption">{t('close.countNote')}</Text>
            </View>

            {/* Cash deposits: a record of cash already taken to the bank (or kept back). */}
            {data.deposits ? (
              <View testID="deposits" className="mt-3 rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
                <Text className="text-sm font-semibold">{t('deposit.heading')}</Text>
                {data.deposits.map((d: CashDeposit) => (
                  <View key={d.id} testID={`deposit-${d.id}`} className="flex-row items-center justify-between" style={{gap: 8}}>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold">
                        {d.kind === 'float' ? t('deposit.keptBack') : t('deposit.cashDeposit')} · {formatMoney(d.amount)}
                        {d.userId ? ` · ${memberName(d.userId)}` : ''}
                      </Text>
                      <Text variant="caption">
                        {d.kind === 'float' ? t('deposit.inShop') : d.matched ? t('close.inBank') : t('close.notInBank')}
                      </Text>
                    </View>
                    {canDeposit && d.kind === 'deposit' && !d.matched ? (
                      <Button testID={`deposit-match-${d.id}`} title={t('recon.matchByHand')} variant="secondary"
                        onPress={() => navigation.navigate('BankMatch', {deposit: d})} />
                    ) : null}
                    {canDeposit && !d.matched ? (
                      <Button title={t('deposit.remove')} variant="ghost" onPress={() => removeDeposit(d)} />
                    ) : null}
                  </View>
                ))}
                {/* One row per salesperson on a beat, pre-filled with their counted cash. */}
                {canDeposit && beatId ? (data.members ?? []).filter(m => m.userId).map(m => {
                  const uid = m.userId as string;
                  const preset = m.cashCounted ?? m.cash;
                  return (
                    <View key={uid} testID={`deposit-person-${uid}`} className="flex-row items-center" style={{gap: 8}}>
                      <Text className="flex-1 text-sm">{personLabel(m.name, m.mobile)}</Text>
                      <View className="flex-1">
                        <Input testID={`deposit-person-input-${uid}`} keyboardType="decimal-pad"
                          value={personDeposit[uid] ?? preset}
                          onChangeText={v => setPersonDeposit(c => ({...c, [uid]: v.replace(/[^0-9.]/g, '')}))} />
                      </View>
                      <Button testID={`deposit-person-save-${uid}`} title={t('deposit.save')} variant="secondary"
                        disabled={saving || !Number(personDeposit[uid] ?? preset)}
                        onPress={() => saveDeposit(uid, personDeposit[uid] ?? preset)} />
                    </View>
                  );
                }) : null}
                {canDeposit ? (
                  <>
                    {beatId && (data.members ?? []).some(m => m.userId) ? (
                      <Text variant="caption">{t('deposit.wholeBeat')}</Text>
                    ) : null}
                    <View className="flex-row" style={{gap: 8}}>
                      <FilterChip label={t('deposit.cashDeposit')} selected={depositKind === 'deposit'}
                        onPress={() => setDepositKind('deposit')} />
                      <FilterChip label={t('deposit.keptBack')} selected={depositKind === 'float'}
                        onPress={() => setDepositKind('float')} />
                    </View>
                    <Input testID="deposit-amount" placeholder={t('deposit.amountPlaceholder')} keyboardType="decimal-pad"
                      value={depositAmount} onChangeText={v => setDepositAmount(v.replace(/[^0-9.]/g, ''))} />
                    <Button testID="deposit-save" title={t('deposit.save')} variant="secondary" loading={saving}
                      disabled={!depositAmount || saving} onPress={() => saveDeposit()} />
                  </>
                ) : null}
                <Text variant="caption">{t('deposit.note')}</Text>
              </View>
            ) : null}

            {data.collections.map(c => (
              <View key={c.id} className="mt-3 flex-row items-center justify-between rounded-2xl bg-white p-3">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-slate-900">{c.customerName}</Text>
                  <Text variant="caption">
                    {c.mode ? paymentMethodLabel(t, c.mode) : '—'}
                    {c.reference ? ` · ${c.reference}` : ''}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-semibold text-slate-900">{formatMoney(c.amount)}</Text>
                  <Text variant="caption">
                    {c.mode === 'cash' ? t('close.cash') : c.verified ? t('close.inBank') : t('close.notInBank')}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Row({label, value, bold}: {label: string; value: string; bold?: boolean}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={`text-sm ${bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{label}</Text>
      <Text className={`text-sm ${bold ? 'font-bold text-slate-900' : 'font-semibold text-slate-900'}`}>{value}</Text>
    </View>
  );
}
