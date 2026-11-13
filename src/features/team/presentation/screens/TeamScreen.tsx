import {useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {FormField, TextField} from '@components/form';
import {
  Button,
  ErrorState,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
} from '@components/ui';
import type {Role} from '@features/auth/rbac';
import {useTeam, useTeamMutations} from '@features/team/presentation/hooks';
import type {TeamMember} from '@features/team/data/team.remote';
import {invitesRemote, type TeamInviteEntry} from '@features/team/data/invites';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatTimestampDate} from '@utils/date';
import {onlyDigits} from '@utils/validation';

const ROLES: Role[] = ['staff', 'accountant', 'owner'];
const roleKey = (r: Role) => `team.role.${r}` as TKey;
const hintKey = (r: Role) => `team.hint.${r}` as TKey;

/** Owner: invite by mobile, change roles, remove access (instant), and see what accountants did. */
export function TeamScreen({navigation}: AppScreenProps<'Team'>): React.JSX.Element {
  const t = useT();
  const {data, isLoading, isError, error, refetch, isRefetching} = useTeam();
  const {add, updateRole, remove, rename} = useTeamMutations();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<TeamMember | null>(null);
  const [newName, setNewName] = useState('');

  /** A 10-digit mobile, or (AC2) an email for a CA who works by email. */
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [formError, setFormError] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const qc = useQueryClient();
  const invites = useQuery({queryKey: ['team-invites'], queryFn: invitesRemote.list});

  const failed = (title: TKey) => (e: unknown) =>
    Alert.alert(t(title), e instanceof Error ? e.message : t('common.tryAgainMsg'));

  const reset = () => {
    setContact('');
    setName('');
    setRole('staff');
  };

  /** AC2: the same invite, delivered by email; the person joins from the link. */
  const onEmail = async (email: string) => {
    setEmailing(true);
    try {
      await invitesRemote.byEmail(email, role, name.trim() || undefined);
      reset();
      Alert.alert(t('team.emailSentTitle'), t('team.emailSent', {email}));
    } catch (e) {
      failed('team.addFailed')(e);
    } finally {
      setEmailing(false);
      await qc.invalidateQueries({queryKey: ['team-invites']});
    }
  };

  const onResend = async (inv: TeamInviteEntry) => {
    try {
      await invitesRemote.resend(inv.id);
      Alert.alert(t('team.emailSentTitle'), t('team.emailSent', {email: inv.to ?? ''}));
    } catch (e) {
      failed('team.addFailed')(e);
    } finally {
      await qc.invalidateQueries({queryKey: ['team-invites']});
    }
  };

  const onAdd = () => {
    const value = contact.trim();
    if (value.includes('@')) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        setFormError(t('team.contactInvalid'));
        return;
      }
      setFormError(null);
      void onEmail(value);
      return;
    }
    const mobile = onlyDigits(value);
    if (mobile.length !== 10) {
      setFormError(t('team.contactInvalid'));
      return;
    }
    setFormError(null);
    add.mutate(
      {mobile, role, name: name.trim() || undefined},
      {
        onSuccess: () => {
          reset();
          void qc.invalidateQueries({queryKey: ['team-invites']});
        },
        onError: failed('team.addFailed'),
      },
    );
  };

  const inviteStatus = (inv: TeamInviteEntry) =>
    inv.status === 'pending' && inv.expiresAt
      ? t('team.inviteStatus.pending', {date: formatTimestampDate(inv.expiresAt)})
      : t(`team.inviteStatus.${inv.status}` as TKey);

  const confirmRemove = (m: TeamMember) =>
    Alert.alert(t('team.removeTitle'), t('team.removeMsg', {mobile: m.mobile}), [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('team.removeYes'),
        style: 'destructive',
        onPress: () => remove.mutate(m.userId, {onError: failed('team.removeFailed')}),
      },
    ]);

  const onManage = (m: TeamMember) =>
    Alert.alert(m.mobile || t('team.member'), t('team.currentRole', {role: t(roleKey(m.role))}), [
      ...ROLES.filter(r => r !== m.role).map(r => ({
        text: t('team.makeRole', {role: t(roleKey(r))}),
        onPress: () => updateRole.mutate({userId: m.userId, role: r}, {onError: failed('team.updateFailed')}),
      })),
      {text: t('team.rename'), onPress: () => { setRenaming(m); setNewName(m.name ?? ''); }},
      ...(m.role === 'accountant'
        ? [{text: t('team.viewActivity'), onPress: () => navigation.navigate('AccountantActivity', {userId: m.userId, mobile: m.mobile})}]
        : []),
      {text: t('team.removeAccess'), style: 'destructive' as const, onPress: () => confirmRemove(m)},
      {text: t('common.cancel'), style: 'cancel' as const},
    ]);

  const members: TeamMember[] = data ?? [];

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />
        }>
        <Text variant="title">{t('team.title')}</Text>
        <Text variant="subtitle" className="mt-0.5">{t('team.subtitle')}</Text>

        <View className="mt-5 rounded-2xl border border-border bg-white p-4">
          <FormField label={t('team.mobileOrEmail')} required error={formError}>
            <TextField
              testID="team-contact"
              placeholder={t('team.mobileOrEmailPlaceholder')}
              value={contact}
              onChangeText={v => {
                setContact(v.includes('@') ? v.trim() : onlyDigits(v).slice(0, 10));
                if (formError) setFormError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
            />
          </FormField>
          <FormField label={t('team.name')} hint={t('common.optional')}>
            <TextField testID="team-name" placeholder={t('team.namePlaceholder')} value={name}
              onChangeText={setName} maxLength={60} />
          </FormField>
          <FormField label={t('team.roleLabel')} hint={t(hintKey(role))}>
            <SegmentedControl value={role} options={ROLES.map(r => ({label: t(roleKey(r)), value: r}))} onChange={setRole} />
          </FormField>
          <Button testID="team-add" title={t('team.add')} className="mt-3" loading={add.isPending || emailing} onPress={onAdd} />
        </View>

        {renaming ? (
          <View testID="team-rename" className="mt-4 rounded-2xl border border-primary bg-white p-4" style={{gap: 10}}>
            <Text className="text-sm font-semibold">{t('team.renameTitle', {mobile: renaming.mobile})}</Text>
            <TextField value={newName} onChangeText={setNewName} maxLength={60} placeholder={t('team.namePlaceholder')} />
            <Button title={t('common.save')} loading={rename.isPending}
              onPress={() => rename.mutate({userId: renaming.userId, name: newName.trim()},
                {onSuccess: () => setRenaming(null), onError: failed('team.updateFailed')})} />
            <Button title={t('common.cancel')} variant="ghost" onPress={() => setRenaming(null)} />
          </View>
        ) : null}

        <Button testID="team-activity" title={t('team.activityAll')} variant="secondary" className="mt-4"
          onPress={() => navigation.navigate('AccountantActivity', {})} />

        <Text variant="label" className="mb-2 mt-6">{t('team.members')}</Text>
        {isLoading && members.length === 0 ? (
          <View style={{gap: 10}}>
            {Array.from({length: 3}).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </View>
        ) : isError && members.length === 0 ? (
          <ErrorState message={error?.message ?? t('team.loadError')} onRetry={refetch} retrying={isRefetching} />
        ) : (
          <View style={{gap: 10}}>
            {members.map(m => (
              <View key={m.userId} className="flex-row items-center justify-between rounded-2xl border border-border bg-white px-4 py-3">
                <View className="flex-1 pr-3">
                  <Text className="font-semibold text-slate-900">
                    {m.name ? `${m.name} · +91 ${m.mobile}` : m.mobile ? `+91 ${m.mobile}` : t('team.pending')}
                    {m.isSelf ? ` · ${t('team.you')}` : ''}
                  </Text>
                  <Text variant="caption" className="mt-0.5">
                    {t(roleKey(m.role))} · {t(hintKey(m.role))}
                  </Text>
                </View>
                {m.isSelf ? (
                  <View className="rounded-full bg-slate-100 px-3 py-1">
                    <Text className="text-xs font-semibold text-slate-600">{t(roleKey(m.role))}</Text>
                  </View>
                ) : (
                  <Pressable testID={`manage-${m.userId}`} accessibilityRole="button" onPress={() => onManage(m)}
                    className="rounded-full border border-border px-3 py-1.5">
                    <Text className="text-sm font-semibold text-primary">{t('team.manage')}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {/* AC2: the invite log — channel, to whom, who sent it, when, what became of it. */}
        {invites.data?.length ? (
          <>
            <Text variant="label" className="mb-2 mt-6">{t('team.invitesHeading')}</Text>
            {invites.data.slice(0, 20).map((inv: TeamInviteEntry) => (
              <View key={inv.id} testID={`invite-${inv.id}`} className="mb-2 rounded-xl border border-border bg-white p-3">
                <Text className="text-sm font-semibold">{inv.channel === 'email' ? '✉️' : '📱'} {inv.to}</Text>
                <Text variant="caption">
                  {t('team.inviteMeta', {role: t(roleKey(inv.role)), by: inv.sentBy, date: formatTimestampDate(inv.sentAt)})}
                </Text>
                <Text variant="caption">{inviteStatus(inv)}</Text>
                {inv.channel === 'email' && (inv.status === 'pending' || inv.status === 'expired') ? (
                  <Button testID={`invite-resend-${inv.id}`} title={t('team.resend')} variant="ghost" className="mt-1"
                    fullWidth={false} onPress={() => void onResend(inv)} />
                ) : null}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
