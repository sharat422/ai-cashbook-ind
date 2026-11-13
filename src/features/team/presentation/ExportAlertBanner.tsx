import {useQuery, useQueryClient} from '@tanstack/react-query';
import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {teamRemote, type ExportAlert} from '@features/team/data/team.remote';
import {useT, type TKey} from '@/i18n';
import {formatTimestamp} from '@utils/date';
import {personLabel} from '@utils/personLabel';

const SHOW = 3;

/**
 * AC4, owner's home screen: "CA exported the Tally file, 13 Nov 2026 10:32 AM IST".
 * A notice, not a permission: the export already happened. Opening it clears it
 * (the audit log keeps the row) and shows the accountant activity.
 */
export function ExportAlertBanner({onOpen}: {onOpen: () => void}): React.JSX.Element | null {
  const t = useT();
  const qc = useQueryClient();
  const owner = usePermissions().can(PERMISSIONS.TEAM_MANAGE);
  const alerts = useQuery({queryKey: ['export-alerts'], queryFn: teamRemote.exportAlerts, enabled: owner,
    refetchInterval: 5 * 60_000});
  const list: ExportAlert[] = alerts.data ?? [];
  if (!owner || list.length === 0) return null;

  const open = async () => {
    onOpen();
    try {
      await teamRemote.exportAlertsSeen();
    } finally {
      await qc.invalidateQueries({queryKey: ['export-alerts']});
    }
  };

  return (
    <Pressable testID="export-alerts" accessibilityRole="button" onPress={() => void open()}
      className="mt-4 rounded-2xl border border-sky-300 bg-sky-50 p-4">
      <Text className="text-sm font-bold text-sky-900">{t('audit.alertTitle', {count: list.length})}</Text>
      <View className="mt-1" style={{gap: 2}}>
        {list.slice(0, SHOW).map(a => (
          <Text key={a.id} className="text-xs text-sky-900">
            {t('audit.alertLine', {who: personLabel(a.name, a.mobile), what: t(`audit.exportKind.${a.what}` as TKey),
              time: `${formatTimestamp(a.at)} IST`})}
          </Text>
        ))}
        {list.length > SHOW ? <Text className="text-xs text-sky-900">{t('import.andMore', {count: list.length - SHOW})}</Text> : null}
      </View>
      <Text className="mt-2 text-xs font-semibold text-sky-800">{t('audit.alertOpen')}</Text>
    </Pressable>
  );
}
