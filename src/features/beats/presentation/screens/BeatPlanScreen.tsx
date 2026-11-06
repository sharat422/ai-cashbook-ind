import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {FormField, TextField} from '@components/form';
import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {ROLE_LABEL} from '@features/auth/rbac';
import type {Beat} from '@features/beats/data/beats.remote';
import {useBeatMutations, useBeats} from '@features/beats/presentation/hooks';
import {useCustomers} from '@features/customers/presentation/hooks/useCustomers';
import type {TeamMember} from '@features/team/data/team.remote';
import {useTeam} from '@features/team/presentation/hooks';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

type Picked = Array<{id: string; name: string}>;

/** Owner: create beats (name, days, salesperson, retailers) and set visit order. */
export function BeatPlanScreen({navigation}: AppScreenProps<'BeatPlan'>): React.JSX.Element {
  const t = useT();
  const beats = useBeats();
  const team = useTeam();
  const members: TeamMember[] = team.data ?? [];
  const list: Beat[] = beats.data ?? [];
  const {create, setRetailers} = useBeatMutations();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>([]);

  const dayNames = (ds: number[]) => ds.map(d => t(`beats.day${d}` as TKey)).join(', ');
  const memberLabel = (userId: string | null) => {
    const m = members.find(x => x.userId === userId);
    return m ? `${m.mobile} · ${ROLE_LABEL[m.role]}` : t('beats.unassigned');
  };

  const startCreate = () => {
    setName('');
    setDays([]);
    setAssignee(null);
    setPicked([]);
    setEditing(null);
    setCreating(true);
  };
  const startEdit = (beat: Beat) => {
    setPicked(beat.retailers.map(r => ({id: r.customerId, name: r.fullName})));
    setCreating(false);
    setEditing(beat.id);
  };
  const onError = (err: Error) => Alert.alert(t('form.couldNotSave'), err.message);

  const saveNew = () => {
    if (!name.trim() || days.length === 0) {
      Alert.alert(t('beats.needNameAndDays'));
      return;
    }
    create.mutate(
      {name: name.trim(), weekdays: days, assignedUserId: assignee, customerIds: picked.map(p => p.id)},
      {onSuccess: () => setCreating(false), onError},
    );
  };
  const saveOrder = (beatId: string) =>
    setRetailers.mutate(
      {beatId, customerIds: picked.map(p => p.id)},
      {onSuccess: () => setEditing(null), onError},
    );

  if (beats.isLoading) {
    return (
      <Screen>
        <Skeleton className="mt-6 h-24 w-full" />
      </Screen>
    );
  }
  if (beats.isError) {
    return (
      <Screen>
        <ErrorState onRetry={() => beats.refetch()} retrying={beats.isFetching} />
      </Screen>
    );
  }

  return (
    <Screen className="py-6">
      <Text variant="title">{t('beats.planTitle')}</Text>
      <Text variant="subtitle" className="mt-1">
        {t('beats.planSubtitle')}
      </Text>

      {creating ? (
        <View className="mt-6 rounded-2xl border border-border bg-white p-4" style={{gap: 14}}>
          <FormField label={t('beats.name')} required>
            <TextField value={name} onChangeText={setName} maxLength={100} placeholder={t('beats.namePlaceholder')} />
          </FormField>
          <FormField label={t('beats.days')} required>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {WEEKDAYS.map(d => (
                <FilterChip
                  key={d}
                  label={t(`beats.day${d}` as TKey)}
                  selected={days.includes(d)}
                  onPress={() => setDays(ds => (ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort()))}
                />
              ))}
            </View>
          </FormField>
          <FormField label={t('beats.salesperson')}>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {members.map(m => (
                <FilterChip
                  key={m.userId}
                  label={memberLabel(m.userId)}
                  selected={assignee === m.userId}
                  onPress={() => setAssignee(a => (a === m.userId ? null : m.userId))}
                />
              ))}
            </View>
          </FormField>
          <RetailerPicker picked={picked} onChange={setPicked} />
          <Button title={t('beats.create')} loading={create.isPending} onPress={saveNew} />
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setCreating(false)} />
        </View>
      ) : (
        <Button title={t('beats.newBeat')} className="mt-6" onPress={startCreate} />
      )}

      {list.length === 0 && !creating ? (
        <EmptyState icon="🗺️" title={t('beats.noBeats')} message={t('beats.noBeatsMsg')} />
      ) : null}

      {list.map(beat => (
        <View key={beat.id} className="mt-4 rounded-2xl border border-border bg-white p-4">
          <Text className="text-base font-semibold text-slate-900">{beat.name}</Text>
          <Text variant="caption">{dayNames(beat.weekdays)}</Text>
          <Text variant="caption">
            {memberLabel(beat.assignedUserId)} · {t('beats.retailerCount', {count: beat.retailers.length})}
          </Text>
          {editing === beat.id ? (
            <View className="mt-3" style={{gap: 10}}>
              <RetailerPicker picked={picked} onChange={setPicked} />
              <Button
                title={t('beats.saveOrder')}
                loading={setRetailers.isPending}
                onPress={() => saveOrder(beat.id)}
              />
              <Button title={t('common.cancel')} variant="ghost" onPress={() => setEditing(null)} />
            </View>
          ) : (
            <View className="mt-3 flex-row" style={{gap: 8}}>
              <Button
                title={t('beats.openDayList')}
                variant="secondary"
                className="flex-1"
                onPress={() => navigation.navigate('BeatDayList', {beatId: beat.id})}
              />
              <Button
                title={t('beats.editRetailers')}
                variant="secondary"
                className="flex-1"
                onPress={() => startEdit(beat)}
              />
            </View>
          )}
        </View>
      ))}
    </Screen>
  );
}

/** The beat's retailers in visit order (↑ ↓ to move, ✕ to drop) + search to add. */
function RetailerPicker({picked, onChange}: {picked: Picked; onChange: (p: Picked) => void}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const customers = useCustomers(search);
  const move = (i: number, by: number) => {
    const next = [...picked];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const ids = new Set(picked.map(p => p.id));

  return (
    <FormField label={t('beats.retailersInOrder')}>
      {picked.map((p, i) => (
        <View key={p.id} className="mb-2 flex-row items-center" style={{gap: 6}}>
          <Text className="flex-1 text-sm text-slate-900">
            {i + 1}. {p.name}
          </Text>
          <OrderButton label="↑" disabled={i === 0} onPress={() => move(i, -1)} />
          <OrderButton label="↓" disabled={i === picked.length - 1} onPress={() => move(i, 1)} />
          <OrderButton label="✕" onPress={() => onChange(picked.filter(x => x.id !== p.id))} />
        </View>
      ))}
      <TextField
        className="mt-1"
        value={search}
        onChangeText={setSearch}
        placeholder={t('beats.addRetailer')}
      />
      {search.trim()
        ? customers.items
            .filter(c => !ids.has(c.id))
            .slice(0, 6)
            .map(c => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => {
                  onChange([...picked, {id: c.id, name: c.fullName}]);
                  setSearch('');
                }}
                className="border-b border-border py-2">
                <Text className="text-sm text-slate-900">＋ {c.fullName}</Text>
              </Pressable>
            ))
        : null}
    </FormField>
  );
}

function OrderButton({label, disabled, onPress}: {label: string; disabled?: boolean; onPress: () => void}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`h-8 w-8 items-center justify-center rounded-full border border-border ${disabled ? 'opacity-30' : ''}`}>
      <Text className="text-sm">{label}</Text>
    </Pressable>
  );
}
