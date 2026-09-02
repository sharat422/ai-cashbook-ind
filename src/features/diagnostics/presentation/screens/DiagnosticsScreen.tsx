import React from 'react';
import {Alert, ScrollView, View} from 'react-native';
import Share from 'react-native-share';

import {Button, EmptyState, Screen, Text} from '@components/ui';
import {
  formatErrorLog,
  useErrorLogStore,
} from '@/services/diagnostics/errorLog.store';
import {useT} from '@/i18n';
import {formatDisplayDate} from '@utils/date';

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return formatDisplayDate(iso.slice(0, 10));
}

export function DiagnosticsScreen(): React.JSX.Element {
  const t = useT();
  const entries = useErrorLogStore(s => s.entries);
  const clear = useErrorLogStore(s => s.clear);

  const onShare = async () => {
    try {
      await Share.open({
        title: t('diagnostics.title'),
        message: formatErrorLog(entries),
        failOnCancel: false,
      });
    } catch {
      // user cancelled — ignore
    }
  };

  const onClear = () =>
    Alert.alert(t('diagnostics.clearTitle'), t('diagnostics.clearMsg'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('diagnostics.clear'), style: 'destructive', onPress: clear},
    ]);

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}>
        <Text variant="title">{t('diagnostics.title')}</Text>
        <Text variant="subtitle" className="mt-0.5">
          {t('diagnostics.subtitle')}
        </Text>

        {entries.length === 0 ? (
          <View className="mt-10">
            <EmptyState
              icon="✅"
              title={t('diagnostics.emptyTitle')}
              message={t('diagnostics.emptyMsg')}
            />
          </View>
        ) : (
          <>
            <View className="mt-5 flex-row" style={{gap: 12}}>
              <Button
                title={t('diagnostics.share')}
                className="flex-1"
                fullWidth={false}
                onPress={onShare}
              />
              <Button
                title={t('diagnostics.clear')}
                variant="secondary"
                className="flex-1"
                fullWidth={false}
                onPress={onClear}
              />
            </View>

            <View className="mt-5" style={{gap: 10}}>
              {entries.map(e => (
                <View
                  key={e.id}
                  className="rounded-2xl border border-border bg-white p-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {e.context}
                    </Text>
                    <Text variant="caption">{timeAgo(e.at)}</Text>
                  </View>
                  <Text className="mt-1 text-sm text-slate-900">{e.message}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
