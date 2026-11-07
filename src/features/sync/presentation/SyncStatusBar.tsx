import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React from 'react';
import {Pressable} from 'react-native';

import {Text} from '@components/ui';
import {useConnectivity} from '@features/income/presentation/hooks/useConnectivity';
import {useT} from '@/i18n';
import type {AppStackParamList} from '@navigation/types';
import {syncState, useSyncCounts, type SyncState} from '../syncStatus';

const STYLE: Record<SyncState, {icon: string; box: string; text: string}> = {
  synced: {icon: '✓', box: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-800'},
  pending: {icon: '⏳', box: 'border-amber-200 bg-amber-50', text: 'text-amber-800'},
  failed: {icon: '⚠️', box: 'border-red-200 bg-red-50', text: 'text-red-800'},
  conflict: {icon: '⚖️', box: 'border-violet-200 bg-violet-50', text: 'text-violet-800'},
};

/** One line on home: synced / pending / failed / conflict. Tap for details. */
export function SyncStatusBar(): React.JSX.Element {
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const online = useConnectivity();
  const counts = useSyncCounts();
  const state = syncState(counts);
  const s = STYLE[state];
  const label = {
    synced: t('sync.state.synced'),
    pending: t('sync.state.pending', {count: counts.pending}),
    failed: t('sync.state.failed', {count: counts.failed}),
    conflict: t('sync.state.conflict', {count: counts.conflicts}),
  }[state];

  return (
    <Pressable
      testID="sync-status-bar"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => navigation.navigate('SyncStatus')}
      className={`mt-3 flex-row items-center rounded-xl border px-3 py-2 ${s.box}`}>
      <Text className={`text-sm font-semibold ${s.text}`}>
        {s.icon} {label}
        {online ? '' : ` · ${t('sync.offline')}`}
      </Text>
    </Pressable>
  );
}
