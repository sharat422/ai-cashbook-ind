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
import {ROLE_LABEL, type Role} from '@features/auth/rbac';
import {useTeam, useTeamMutations} from '@features/team/presentation/hooks';
import type {TeamMember} from '@features/team/data/team.remote';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';
import {onlyDigits} from '@utils/validation';

const ROLE_OPTIONS = [
  {label: 'Staff', value: 'staff' as Role},
  {label: 'Accountant', value: 'accountant' as Role},
  {label: 'Owner', value: 'owner' as Role},
];

const ROLE_HINT: Record<Role, string> = {
  owner: 'Full access',
  accountant: 'View + export + add/edit · no delete',
  staff: 'Add entries only',
};

export function TeamScreen(): React.JSX.Element {
  const {data, isLoading, isError, error, refetch, isRefetching} = useTeam();
  const {add, updateRole, remove} = useTeamMutations();

  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [formError, setFormError] = useState<string | null>(null);

  const onAdd = () => {
    if (mobile.length !== 10) {
      setFormError('Enter a 10-digit mobile number');
      return;
    }
    setFormError(null);
    add.mutate(
      {mobile, role},
      {
        onSuccess: () => {
          setMobile('');
          setRole('staff');
        },
        onError: e =>
          Alert.alert('Could not add', e instanceof Error ? e.message : 'Try again.'),
      },
    );
  };

  const onManage = (m: TeamMember) => {
    const options = ROLE_OPTIONS.filter(o => o.value !== m.role).map(o => ({
      text: `Make ${o.label}`,
      onPress: () =>
        updateRole.mutate(
          {userId: m.userId, role: o.value},
          {onError: e => Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.')},
        ),
    }));
    Alert.alert(
      m.mobile || 'Member',
      `Current role: ${ROLE_LABEL[m.role]}`,
      [
        ...options,
        {
          text: 'Remove from business',
          style: 'destructive',
          onPress: () =>
            remove.mutate(m.userId, {
              onError: e => Alert.alert('Could not remove', e instanceof Error ? e.message : 'Try again.'),
            }),
        },
        {text: 'Cancel', style: 'cancel'},
      ],
    );
  };

  const members: TeamMember[] = data ?? [];

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }>
        <Text variant="title">Team</Text>
        <Text variant="subtitle" className="mt-0.5">
          Invite people by mobile number and set what they can do. They get
          access the next time they log in with that number.
        </Text>

        {/* Add member */}
        <View className="mt-5 rounded-2xl border border-border bg-white p-4">
          <FormField label="Mobile number" required error={formError}>
            <TextField
              placeholder="10-digit mobile number"
              value={mobile}
              onChangeText={v => {
                setMobile(onlyDigits(v).slice(0, 10));
                if (formError) setFormError(null);
              }}
              keyboardType="number-pad"
              maxLength={10}
            />
          </FormField>
          <FormField label="Role" hint={ROLE_HINT[role]}>
            <SegmentedControl value={role} options={ROLE_OPTIONS} onChange={setRole} />
          </FormField>
          <Button
            title="Add to business"
            className="mt-3"
            loading={add.isPending}
            onPress={onAdd}
          />
        </View>

        {/* Members */}
        <Text variant="label" className="mt-6 mb-2">
          Members
        </Text>
        {isLoading && members.length === 0 ? (
          <View style={{gap: 10}}>
            {Array.from({length: 3}).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </View>
        ) : isError && members.length === 0 ? (
          <ErrorState
            message={error?.message ?? 'Could not load the team.'}
            onRetry={refetch}
            retrying={isRefetching}
          />
        ) : (
          <View style={{gap: 10}}>
            {members.map(m => (
              <View
                key={m.userId}
                className="flex-row items-center justify-between rounded-2xl border border-border bg-white px-4 py-3">
                <View className="flex-1 pr-3">
                  <Text className="font-semibold text-slate-900">
                    {m.mobile ? `+91 ${m.mobile}` : 'Pending member'}
                    {m.isSelf ? ' · You' : ''}
                  </Text>
                  <Text variant="caption" className="mt-0.5">
                    {ROLE_LABEL[m.role]} · {ROLE_HINT[m.role]}
                  </Text>
                </View>
                {m.isSelf ? (
                  <View className="rounded-full bg-slate-100 px-3 py-1">
                    <Text className="text-xs font-semibold text-slate-600">
                      {ROLE_LABEL[m.role]}
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onManage(m)}
                    className="rounded-full border border-border px-3 py-1.5">
                    <Text className="text-sm font-semibold text-primary">Manage</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
