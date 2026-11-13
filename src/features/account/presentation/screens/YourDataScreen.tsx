import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {downloadAndShare} from '@api/download';
import {ApiError, NetworkError} from '@api/client';
import {Button, Screen, Text} from '@components/ui';
import {downloadMyData} from '@features/account/presentation/downloadMyData';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {translate, useT, type TKey} from '@/i18n';
import {useAuthStore} from '@store/auth.store';
import {todayIST} from '@utils/date';

/**
 * BLOCKED: the founder has not yet given the approved free-export wording.
 * Until then the screen shows plain-language draft text under a "Draft"
 * banner, and it is not linked or presented as a Terms / legal page. When
 * the approved text arrives: replace the `yourData.draft.*` strings in
 * en.json, run the translation tool, and set this to true.
 */
export const FREE_EXPORT_WORDING_APPROVED = false;

/** The promise, always shown in Telugu and English (plus the user's own language). */
const PROMISE: TKey[] = ['yourData.draft.what', 'yourData.draft.formats', 'yourData.draft.keep'];

type Kind = 'excel' | 'pdf' | 'backup';

/**
 * "Your data": what the business can take away, for free, and the buttons to
 * do it. Exports need no paid plan — the server never checks one.
 */
export function YourDataScreen(): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const lang = useAuthStore(s => s.preferredLanguage);
  const [busy, setBusy] = useState<Kind | null>(null);
  const languages = [...new Set([lang, 'te', 'en'] as const)];

  const run = async (kind: Kind) => {
    setBusy(kind);
    try {
      if (kind === 'excel') {
        await downloadAndShare(`/account/export.xlsx?lang=${lang}`, `Bolcash_data_${todayIST()}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else if (kind === 'pdf') {
        await downloadAndShare(`/account/balances.pdf?lang=${lang}`, `Bolcash_balances_${todayIST()}.pdf`, 'application/pdf');
      } else if (await downloadMyData()) {
        Alert.alert(t('account.exportReadyTitle'), t('account.exportReadyMsg'));
      }
    } catch (e) {
      Alert.alert(
        t('account.exportErrorTitle'),
        e instanceof ApiError || e instanceof NetworkError ? e.message : t('common.tryAgainMsg'),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('yourData.title')}</Text>

        {FREE_EXPORT_WORDING_APPROVED ? null : (
          <View testID="draft-banner" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <Text className="text-sm font-bold text-amber-800">{t('yourData.draftBadge')}</Text>
            <Text className="mt-1 text-xs text-amber-800">{t('yourData.draftNote')}</Text>
          </View>
        )}

        {languages.map(l => (
          <View key={l} className="mt-4 rounded-2xl border border-border bg-white p-4" style={{gap: 8}}>
            {PROMISE.map(key => (
              <Text key={key} className="text-sm leading-5 text-slate-800">
                • {translate(l, key)}
              </Text>
            ))}
          </View>
        ))}

        <Text variant="label" className="mb-3 mt-8">
          {t('yourData.download')}
        </Text>
        {can(PERMISSIONS.REPORTS_EXPORT) ? (
          <>
            <Button testID="export-excel" title={t('yourData.excel')} variant="secondary" className="mb-3"
              loading={busy === 'excel'} disabled={busy !== null} onPress={() => run('excel')} />
            <Button testID="export-pdf" title={t('yourData.pdf')} variant="secondary" className="mb-3"
              loading={busy === 'pdf'} disabled={busy !== null} onPress={() => run('pdf')} />
          </>
        ) : (
          <Text variant="caption" className="mb-3">{t('yourData.ownerOnly')}</Text>
        )}
        <Button testID="export-backup" title={t('yourData.backup')} variant="secondary"
          loading={busy === 'backup'} disabled={busy !== null} onPress={() => run('backup')} />
        <Text variant="caption" className="mt-3">{t('yourData.statementHint')}</Text>
      </View>
    </Screen>
  );
}
