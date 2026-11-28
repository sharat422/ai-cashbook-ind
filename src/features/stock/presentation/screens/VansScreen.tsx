import {useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useEffect, useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {FormField, TextField} from '@components/form';
import {BottomSheet, Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {stockRemote, type VanRecord} from '@features/stock/data/stock.remote';
import {STOCK_KEY} from '@features/stock/presentation/hooks';
import type {TeamMember} from '@features/team/data/team.remote';
import {useTeam} from '@features/team/presentation/hooks';
import {useT} from '@/i18n';
import {personLabel} from '@utils/personLabel';

const VANS_KEY = [STOCK_KEY, 'vans'];

/**
 * Settings → Vans (owner): a name and registration for each van, and who drives
 * it. A van's stock is its driver's, as before; the name is what the Stock
 * screen, transfers and bills show (never a phone number).
 */
export function VansScreen(): React.JSX.Element {
  const t = useT();
  const vans = useQuery({queryKey: VANS_KEY, queryFn: stockRemote.vans});
  const team = useTeam();
  const [editing, setEditing] = useState<VanRecord | 'new' | null>(null);
  const members: TeamMember[] = team.data ?? [];
  const list: VanRecord[] = vans.data ?? [];
  const drivers = members.filter(m => m.status === 'active' && m.role !== 'accountant');
  const driverName = (userId: string) => {
    const m = members.find(x => x.userId === userId);
    return m ? personLabel(m.name, m.mobile) : '—';
  };

  return (
    <Screen>
      <View className="py-6" style={{gap: 12}}>
        <Text variant="title">{t('vans.title')}</Text>
        <Text variant="subtitle">{t('vans.subtitle')}</Text>
        {vans.isLoading ? <Skeleton className="h-24 w-full" /> : vans.isError ? (
          <ErrorState onRetry={() => vans.refetch()} retrying={vans.isFetching} />
        ) : list.length === 0 ? (
          <EmptyState icon="🚚" title={t('vans.emptyTitle')} message={t('vans.emptyMsg')} />
        ) : list.map(v => (
          <Pressable key={v.vanId} testID={`van-${v.vanId}`} accessibilityRole="button" onPress={() => setEditing(v)}
            className="rounded-2xl border border-border bg-white p-4">
            <Text className="text-base font-semibold">🚚 {v.name}</Text>
            {v.registration ? <Text variant="caption">{v.registration}</Text> : null}
            <Text variant="caption">{t('vans.driver', {name: v.staffName || driverName(v.userId)})}</Text>
          </Pressable>
        ))}
        <Button testID="van-add" title={t('vans.add')} variant="secondary" onPress={() => setEditing('new')} />
      </View>
      <VanSheet van={editing} drivers={drivers.map(m => ({userId: m.userId, label: personLabel(m.name, m.mobile)}))}
        onClose={() => setEditing(null)} />
    </Screen>
  );
}

function VanSheet({van, drivers, onClose}: {
  van: VanRecord | 'new' | null;
  drivers: {userId: string; label: string}[];
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const existing = van && van !== 'new' ? van : null;
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(existing?.name ?? '');
    setRegistration(existing?.registration ?? '');
    setUserId(existing?.userId ?? null);
  }, [van]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const body = {name: name.trim(), registration: registration.trim(), userId};
      await (existing ? stockRemote.editVan(existing.vanId, body) : stockRemote.addVan(body));
      await qc.invalidateQueries({queryKey: [STOCK_KEY]}); // the van list and every stock screen's labels
      onClose();
    } catch (e) {
      Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={van !== null} onClose={onClose} title={existing ? t('vans.edit') : t('vans.add')}>
      <View className="px-5 pb-5 pt-1" style={{gap: 14}}>
        <FormField label={t('vans.name')} required>
          <TextField testID="van-name" value={name} onChangeText={setName} maxLength={40}
            placeholder={t('vans.namePlaceholder')} />
        </FormField>
        <FormField label={t('vans.registration')} hint={t('vans.registrationHint')}>
          <TextField testID="van-registration" value={registration} onChangeText={setRegistration} maxLength={20}
            autoCapitalize="characters" placeholder="KA01AB1234" />
        </FormField>
        <FormField label={t('vans.driverLabel')} required hint={t('vans.driverHint')}>
          <View className="flex-row flex-wrap" style={{gap: 8}}>
            {drivers.map(d => (
              <FilterChip key={d.userId} label={d.label} selected={userId === d.userId}
                onPress={() => setUserId(d.userId)} />
            ))}
          </View>
        </FormField>
        <Button testID="van-save" title={t('common.save')} loading={saving}
          disabled={!name.trim() || !userId || saving} onPress={() => void save()} />
      </View>
    </BottomSheet>
  );
}
