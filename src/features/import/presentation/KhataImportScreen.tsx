import {errorCodes, isErrorWithCode, pick, types} from '@react-native-documents/picker';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {downloadAndShare} from '@api/download';
import {Button, Screen, Select, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {formatDisplayDate, formatTimestamp} from '@utils/date';
import {
  IMPORT_FIELDS,
  importRemote,
  type ImportField,
  type ImportLogEntry,
  type ImportPreview,
  type Mapping,
  type PickedFile,
} from '../import.remote';

const HISTORY_KEY = ['imports'];
const LIST = 10;
const NONE = 'none';

const column = (i: number): string =>
  (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));

/**
 * Bring an old khata in from Excel/CSV: pick the file, check which column is
 * which, look at the dry run (nothing saved), then import. Duplicates are
 * skipped, so importing the same file again adds nothing.
 */
export function KhataImportScreen(_: AppScreenProps<'KhataImport'>): React.JSX.Element {
  const t = useT();
  const {can} = usePermissions();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const history = useQuery({queryKey: HISTORY_KEY, queryFn: importRemote.history, enabled: can(PERMISSIONS.ENTRY_EDIT)});

  if (!can(PERMISSIONS.ENTRY_EDIT)) {
    return (
      <Screen>
        <View className="py-6">
          <Text variant="title">{t('import.title')}</Text>
          <Text variant="subtitle" className="mt-2">{t('import.ownerOnly')}</Text>
        </View>
      </Screen>
    );
  }

  const fail = (err: unknown) =>
    Alert.alert(t('import.failed'), err instanceof Error ? err.message : t('common.tryAgainMsg'));

  const runPreview = async (f: PickedFile, mapping?: Mapping) => {
    setBusy('preview');
    try {
      setPreview(await importRemote.preview(f, mapping));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onPick = async () => {
    try {
      const [picked] = await pick({type: [types.allFiles]}); // the server checks the content
      const f = {uri: picked.uri, name: picked.name ?? 'khata.csv', type: picked.type ?? 'text/csv'};
      setFile(f);
      setPreview(null);
      await runPreview(f);
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      fail(err);
    }
  };

  const remap = (field: ImportField, value: string) => {
    if (!file || !preview) return;
    void runPreview(file, {...preview.mapping, [field]: value === NONE ? null : Number(value)});
  };

  const doImport = async () => {
    if (!file || !preview) return;
    setBusy('import');
    try {
      const log = await importRemote.run(file, preview.mapping);
      setFile(null);
      setPreview(null);
      await queryClient.invalidateQueries();
      Alert.alert(
        t('import.doneTitle', {count: log.rowsImported}),
        t('import.doneMsg', {skipped: log.rowsSkipped, retailers: log.newRetailers}),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onImport = () =>
    preview &&
    Alert.alert(
      t('import.confirmTitle', {count: preview.toImport}),
      t('import.confirmMsg', {retailers: preview.newRetailers.length}),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {text: t('import.confirmYes'), onPress: () => void doImport()},
      ],
    );

  const backup = (id: string, day: string) =>
    downloadAndShare(`/imports/${id}/backup.xlsx`, `before_import_${day}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(fail);

  const options = preview ? [NONE, ...preview.headers.map((_h, i) => String(i))] : [NONE];
  const optionLabel = (v: string) =>
    v === NONE ? t('import.notInFile') : `${column(Number(v))}: ${preview?.headers[Number(v)] || '—'}`;

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('import.title')}</Text>
        <Text variant="subtitle" className="mt-1">{t('import.subtitle')}</Text>

        <Button testID="import-pick" title={file ? t('import.pickAnother') : t('import.pick')}
          variant={file ? 'secondary' : 'primary'} className="mt-6"
          loading={busy === 'preview' && !preview} disabled={busy !== null} onPress={onPick} />
        {file ? <Text variant="caption" className="mt-2">{file.name}</Text> : null}

        {preview ? (
          <>
            <Text variant="label" className="mb-1 mt-7">{t('import.mapHeading')}</Text>
            <Text variant="caption" className="mb-3">{t('import.mapHint', {row: preview.headerRow})}</Text>
            {IMPORT_FIELDS.map(field => (
              <View key={field} className="mb-3" testID={`map-${field}`}>
                <Select
                  label={t(`import.field.${field}` as TKey)}
                  value={preview.mapping[field] === null ? NONE : String(preview.mapping[field])}
                  options={options}
                  labelOf={optionLabel}
                  onSelect={v => remap(field, v)}
                  error={preview.missing.includes(field) ? t('import.required') : null}
                />
              </View>
            ))}

            <View testID="dry-run" className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" style={{gap: 4}}>
              <Text className="text-sm font-bold text-amber-900">{t('import.dryRun')}</Text>
              <Text className="text-sm">{t('import.rowCount', {count: preview.rowCount})}</Text>
              <Text testID="to-import" className="text-sm font-semibold">{t('import.toImport', {count: preview.toImport})}</Text>
              <Text className="text-sm">{t('import.newRetailers', {count: preview.newRetailers.length})}</Text>
              <Text className="text-sm">{t('import.duplicates', {count: preview.duplicateCount})}</Text>
              <Text className="text-sm">{t('import.problems', {count: preview.issueCount})}</Text>
              <Text className="text-sm">{t('import.openingTotal', {amount: formatINR(preview.openingTotal)})}</Text>
              <Text className="text-sm">
                {t('import.udharJama', {udhar: formatINR(preview.udharTotal), jama: formatINR(preview.jamaTotal)})}
              </Text>
            </View>

            {preview.newRetailers.length > 0 ? (
              <Detail title={t('import.newRetailersHeading')}
                lines={preview.newRetailers.slice(0, LIST)} more={preview.newRetailers.length - LIST} />
            ) : null}
            {preview.duplicateCount > 0 ? (
              <Detail title={t('import.duplicatesHeading')} more={preview.duplicateCount - LIST}
                lines={preview.duplicates.slice(0, LIST).map(d =>
                  t(d.against === 'books' ? 'import.dupBooks' : 'import.dupFile', {
                    row: d.row, retailer: d.retailer, bill: d.billRef || '—',
                    amount: formatINR(d.amount), date: formatDisplayDate(d.date),
                  }))} />
            ) : null}
            {preview.issueCount > 0 ? (
              <Detail title={t('import.problemsHeading')} more={preview.issueCount - LIST}
                lines={preview.issues.slice(0, LIST).map(i =>
                  t('import.problemRow', {row: i.row, reason: t(`import.reason.${i.reason}` as TKey)}))} />
            ) : null}

            <Button testID="import-run" title={t('import.run', {count: preview.toImport})} className="mt-6"
              loading={busy === 'import'} disabled={busy !== null || preview.toImport === 0 || preview.missing.length > 0}
              onPress={onImport} />
            <Text variant="caption" className="mt-2">{t('import.backupNote')}</Text>
          </>
        ) : null}

        <Text variant="label" className="mb-2 mt-9">{t('import.historyHeading')}</Text>
        {!history.data?.length ? (
          <Text variant="caption">{t('import.noHistory')}</Text>
        ) : (
          history.data.map((h: ImportLogEntry) => (
            <View key={h.id} className="mb-2 rounded-xl border border-border bg-white p-3">
              <Text className="text-sm font-semibold">{h.fileName}</Text>
              <Text variant="caption">{formatTimestamp(h.createdAt)} · {h.importedBy}</Text>
              <Text variant="caption">
                {t('import.historyCounts', {imported: h.rowsImported, skipped: h.rowsSkipped})}
              </Text>
              <Button title={t('import.downloadBackup')} variant="ghost" className="mt-1"
                onPress={() => backup(h.id, h.createdAt.slice(0, 10))} />
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}

function Detail({title, lines, more}: {title: string; lines: string[]; more: number}): React.JSX.Element {
  const t = useT();
  return (
    <View className="mt-4 rounded-xl border border-border bg-white p-3" style={{gap: 2}}>
      <Text className="text-sm font-semibold">{title}</Text>
      {lines.map((l, i) => (
        <Text key={i} variant="caption">{l}</Text>
      ))}
      {more > 0 ? <Text variant="caption">{t('sync.andMore', {count: more})}</Text> : null}
    </View>
  );
}
