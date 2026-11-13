import {personLabel} from '@utils/personLabel';
import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, FormField, TextField} from '@components/form';
import {Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {isBeatChanged, type Beat, type BeatAssignment} from '@features/beats/data/beats.remote';
import {useBeatMutations, useBeats, useDeletedBeats} from '@features/beats/presentation/hooks';
import {useCustomers} from '@features/customers/presentation/hooks/useCustomers';
import type {TeamMember} from '@features/team/data/team.remote';
import {useTeam} from '@features/team/presentation/hooks';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate, todayIST} from '@utils/date';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
/** A year ahead: how far cover can be planned in the date picker. */
const PLAN_AHEAD = () => new Date(Date.now() + 365 * 24 * 3600 * 1000);

type Picked = Array<{id: string; name: string}>;

/** Owner: create, edit and delete beats (name, days, salesperson, retailers) and set visit order. */
export function BeatPlanScreen({navigation}: AppScreenProps<'BeatPlan'>): React.JSX.Element {
  const t = useT();
  const beats = useBeats();
  const team = useTeam();
  const members: TeamMember[] = team.data ?? [];
  const list: Beat[] = beats.data ?? [];
  const {create, setRetailers, edit, remove, assign, unassign, restore} = useBeatMutations();
  const [showDeleted, setShowDeleted] = useState(false);
  const deleted = useDeletedBeats(showDeleted);
  /** 'new', the id of the beat whose details are being edited, or null. */
  const [form, setForm] = useState<string | null>(null);
  const creating = form !== null;
  const [editing, setEditing] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>([]);
  const [helperFrom, setHelperFrom] = useState(todayIST());
  /** The version of the beat when its edit was opened: sent with the save (IM3). */
  const [baseVersion, setBaseVersion] = useState<number | undefined>();
  const [helperTo, setHelperTo] = useState('');

  /** Helpers still on the beat after today, or starting later (one removed today is off). */
  const helpers = (beat: Beat) =>
    beat.assignments.filter(a => a.role === 'secondary' && (a.validTo === null || a.validTo > todayIST()));
  /** "Ravi — from 16 Nov 2026 until 20 Nov 2026"; plain name for open cover that has started. */
  const helperLabel = (a: Pick<BeatAssignment, 'validFrom' | 'validTo'>, who: string) => {
    const dates = [
      a.validFrom > todayIST() ? t('beats.helperFrom', {date: formatDisplayDate(a.validFrom)}) : null,
      a.validTo ? t('beats.helperUntil', {date: formatDisplayDate(a.validTo)}) : null,
    ].filter(Boolean).join(' ');
    return dates ? `${who} — ${dates}` : who;
  };
  const dayNames = (ds: number[]) => ds.map(d => t(`beats.day${d}` as TKey)).join(', ');
  const memberLabel = (userId: string | null) => {
    const m = members.find(x => x.userId === userId);
    return m ? `${personLabel(m.name, m.mobile)} · ${t(`team.role.${m.role}` as TKey)}` : t('beats.unassigned');
  };

  const startCreate = () => {
    setName('');
    setDays([]);
    setAssignee(null);
    setPicked([]);
    setEditing(null);
    setForm('new');
  };
  const startDetails = (beat: Beat) => {
    setName(beat.name);
    setDays(beat.weekdays);
    setAssignee(beat.assignedUserId);
    setHelperFrom(todayIST());
    setHelperTo('');
    setEditing(null);
    setBaseVersion(beat.version);
    setForm(beat.id);
  };
  const confirmDelete = (beat: Beat) =>
    Alert.alert(t('beats.deleteTitle', {name: beat.name}), t('beats.deleteMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('beats.delete'), style: 'destructive', onPress: () => remove.mutate(beat.id, {onError})},
    ]);
  const confirmRestore = (beat: Beat) =>
    Alert.alert(t('beats.restoreTitle', {name: beat.name}), t('beats.restoreMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('beats.restore'), onPress: () => restore.mutate(beat.id, {onError})},
    ]);
  const startEdit = (beat: Beat) => {
    setPicked(beat.retailers.map(r => ({id: r.customerId, name: r.fullName})));
    setForm(null);
    setBaseVersion(beat.version);
    setEditing(beat.id);
  };
  const onError = (err: Error) => Alert.alert(t('form.couldNotSave'), err.message);
  /** Changed on another phone first (IM3): nothing was saved. Close the editor so the
   *  list shows the current beat (refetched), with the notice; open it again to redo the edit. */
  const onEditError = (err: Error) => {
    if (!isBeatChanged(err)) return onError(err);
    setForm(null);
    setEditing(null);
    Alert.alert(err.message);
  };

  const saveNew = () => {
    if (!name.trim() || days.length === 0) {
      Alert.alert(t('beats.needNameAndDays'));
      return;
    }
    if (form !== 'new' && form !== null) {
      edit.mutate(
        {beatId: form, draft: {name: name.trim(), weekdays: days, assignedUserId: assignee}, baseVersion},
        {onSuccess: () => setForm(null), onError: onEditError},
      );
      return;
    }
    create.mutate(
      {name: name.trim(), weekdays: days, assignedUserId: assignee, customerIds: picked.map(p => p.id)},
      {onSuccess: () => setForm(null), onError},
    );
  };
  const saveOrder = (beatId: string) =>
    setRetailers.mutate(
      {beatId, customerIds: picked.map(p => p.id), baseVersion},
      {onSuccess: () => setEditing(null), onError: onEditError},
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
          {form === 'new' ? <RetailerPicker picked={picked} onChange={setPicked} /> : null}
          <Button testID="beat-save" title={form === 'new' ? t('beats.create') : t('beats.saveDetails')}
            loading={create.isPending || edit.isPending} onPress={saveNew} />
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setForm(null)} />
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
            {beat.assignedUserId ? memberLabel(beat.assignedUserId) : t('beats.pickSalesperson')} ·{' '}
            {t('beats.retailerCount', {count: beat.retailers.length})}
          </Text>
          {helpers(beat).length ? (
            <Text testID={`beat-team-${beat.id}`} variant="caption">
              {t('beats.alsoOnBeat')}: {helpers(beat).map(a => helperLabel(a, personLabel(a.name, a.mobile))).join(', ')}
            </Text>
          ) : null}
          {form === beat.id ? (
            <View className="mt-3" style={{gap: 6}}>
              <Text variant="label">{t('beats.alsoOnBeat')}</Text>
              <Text variant="caption">{t('beats.alsoOnBeatHint')}</Text>
              <Text variant="caption">{t('beats.helperDatesHint')}</Text>
              <FormField label={t('beats.helperStart')}>
                <DateField value={helperFrom} onChange={setHelperFrom} maximumDate={PLAN_AHEAD()} />
              </FormField>
              <FormField label={t('beats.helperEnd')}>
                <DateField value={helperTo} onChange={setHelperTo} maximumDate={PLAN_AHEAD()} />
              </FormField>
              {helperTo ? (
                <Button testID="helper-no-end" title={t('beats.noEndDate')} variant="ghost" onPress={() => setHelperTo('')} />
              ) : null}
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {members.filter(m => m.role === 'staff' && m.userId !== beat.assignedUserId).map(m => {
                  const mine = helpers(beat).find(a => a.userId === m.userId);
                  return (
                    <FilterChip
                      key={m.userId}
                      label={mine ? helperLabel(mine, personLabel(m.name, m.mobile)) : personLabel(m.name, m.mobile)}
                      selected={!!mine}
                      onPress={() => mine
                        ? unassign.mutate({beatId: beat.id, userId: m.userId}, {onError})
                        : assign.mutate({beatId: beat.id, userId: m.userId, validFrom: helperFrom, validTo: helperTo || null},
                          {onError})}
                    />
                  );
                })}
              </View>
            </View>
          ) : null}
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
          {editing !== beat.id ? (
            <View className="mt-2 flex-row" style={{gap: 8}}>
              <Button testID={`beat-edit-${beat.id}`} title={t('beats.editDetails')} variant="ghost"
                className="flex-1" onPress={() => startDetails(beat)} />
              <Button testID={`beat-history-${beat.id}`} title={t('visits.open')} variant="ghost" className="flex-1"
                onPress={() => navigation.navigate('VisitHistory', {beatId: beat.id, title: beat.name})} />
              <Button testID={`beat-delete-${beat.id}`} title={t('beats.delete')} variant="ghost" className="flex-1"
                onPress={() => confirmDelete(beat)} />
            </View>
          ) : null}
        </View>
      ))}

      {/* Deleted beats: an owner's undo. They come back as they were. */}
      <Button testID="beats-show-deleted" title={t('beats.deletedBeats')} variant="ghost" className="mt-6"
        onPress={() => setShowDeleted(v => !v)} />
      {showDeleted ? (
        deleted.isLoading ? (
          <Skeleton className="mt-2 h-16 w-full" />
        ) : !deleted.data?.length ? (
          <Text variant="caption" className="mt-2">{t('beats.noDeleted')}</Text>
        ) : (
          deleted.data.map((beat: Beat) => (
            <View key={beat.id} testID={`deleted-beat-${beat.id}`}
              className="mt-2 flex-row items-center rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
              <View className="flex-1">
                <Text className="text-base font-semibold text-slate-900">{beat.name}</Text>
                <Text variant="caption">
                  {dayNames(beat.weekdays)} · {t('beats.retailerCount', {count: beat.retailers.length})}
                </Text>
              </View>
              <Button testID={`beat-restore-${beat.id}`} title={t('beats.restore')} variant="secondary"
                loading={restore.isPending && restore.variables === beat.id} onPress={() => confirmRestore(beat)} />
            </View>
          ))
        )
      ) : null}
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
