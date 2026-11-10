import {errorCodes, isErrorWithCode, pick, types} from '@react-native-documents/picker';
import {useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {Button, Screen, Select, Text} from '@components/ui';
import {FilterChip} from '@components/filters';
import {
  reconciliationRemote,
  STATEMENT_COLUMNS,
  type DateFormat,
  type StatementColumn,
  type StatementFile,
  type StatementMapping,
  type StatementPreview,
} from '@features/reconciliation/data/reconciliation.remote';
import {formatMoney} from '@features/reconciliation/domain/money';
import {RECON_KEY} from '@features/reconciliation/presentation/hooks';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {formatDisplayDate} from '@utils/date';

const NONE = 'none';
const FORMATS: DateFormat[] = ['auto', 'DMY', 'MDY', 'YMD'];

/**
 * Import a bank statement: pick the file, check which column is which and how
 * dates are written (a preview shows the first lines as they'll be read), then
 * import. Nothing is saved until Import.
 */
export function BankImportScreen({navigation}: AppScreenProps<'BankImport'>): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<StatementFile | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat>('auto');
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) =>
    Alert.alert(t('recon.importFailed'), e instanceof Error ? e.message : t('common.tryAgainMsg'));

  const load = async (f: StatementFile, m: StatementMapping | null, fmt: DateFormat) => {
    setBusy(true);
    try {
      const p = await reconciliationRemote.preview(f, m, fmt);
      setPreview(p);
      setMapping(p.mapping ?? m ?? {headerRow: p.headerRow, date: null, credit: null, debit: null,
        amount: null, drcr: null, utr: null, narration: null});
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const onPick = async () => {
    try {
      const [picked] = await pick({type: [types.allFiles]}); // banks label CSVs oddly; the server checks
      const f = {uri: picked.uri, name: picked.name ?? 'statement.csv', type: picked.type ?? 'text/csv'};
      setFile(f);
      setDateFormat('auto');
      await load(f, null, 'auto');
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return;
      fail(e);
    }
  };

  const change = (next: StatementMapping, fmt = dateFormat) => {
    setMapping(next);
    if (file && next.date !== null && (next.credit !== null || next.amount !== null)) void load(file, next, fmt);
  };

  const onImport = async () => {
    if (!file || !mapping) return;
    setBusy(true);
    try {
      const r = await reconciliationRemote.importStatement(file, mapping, dateFormat);
      await qc.invalidateQueries({queryKey: [RECON_KEY]});
      Alert.alert(
        r.alreadyImported ? t('recon.alreadyImported') : t('recon.importedTitle', {count: r.imported}),
        r.alreadyImported ? undefined
          : t('recon.importSummary', {duplicates: r.duplicates, skipped: r.skipped, rejected: r.rejected.length}),
      );
      navigation.goBack();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const headers = preview?.headers ?? [];
  const options = [NONE, ...headers.map((_h, i) => String(i))];
  const label = (v: string) => (v === NONE ? t('import.notInFile') : headers[Number(v)] || `#${Number(v) + 1}`);
  const ready = !!mapping && mapping.date !== null && (mapping.credit !== null || mapping.amount !== null);

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('recon.import')}</Text>
        <Text variant="subtitle" className="mt-1">{t('bankImport.subtitle')}</Text>
        <Button testID="bank-pick" title={file ? t('import.pickAnother') : t('import.pick')} className="mt-5"
          variant={file ? 'secondary' : 'primary'} loading={busy && !preview} disabled={busy} onPress={onPick} />
        {file ? <Text variant="caption" className="mt-2">{file.name}</Text> : null}

        {preview && mapping ? (
          <>
            {preview.needsMapping ? (
              <Text className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {t('bankImport.needsMapping')}
              </Text>
            ) : null}

            <Text variant="label" className="mb-2 mt-6">{t('bankImport.headerRow')}</Text>
            <Select
              value={String(mapping.headerRow)}
              options={preview.rows.map((_r, i) => String(i))}
              labelOf={v => `${Number(v) + 1}: ${preview.rows[Number(v)].filter(Boolean).join(' · ').slice(0, 60)}`}
              onSelect={v => change({...mapping, headerRow: Number(v)})}
            />

            <Text variant="label" className="mb-2 mt-6">{t('import.mapHeading')}</Text>
            {STATEMENT_COLUMNS.map((col: StatementColumn) => (
              <View key={col} className="mb-3" testID={`bank-map-${col}`}>
                <Select
                  label={t(`bankImport.col.${col}` as TKey)}
                  value={mapping[col] === null ? NONE : String(mapping[col])}
                  options={options}
                  labelOf={label}
                  onSelect={v => change({...mapping, [col]: v === NONE ? null : Number(v)})}
                />
              </View>
            ))}

            <Text variant="label" className="mb-2 mt-4">{t('bankImport.dateFormat')}</Text>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {FORMATS.map(f => (
                <FilterChip key={f} label={t(`bankImport.fmt.${f}` as TKey)} selected={dateFormat === f}
                  onPress={() => { setDateFormat(f); change(mapping, f); }} />
              ))}
            </View>

            {preview.sample ? (
              <View testID="bank-sample" className="mt-5 rounded-2xl border border-border bg-white p-4" style={{gap: 4}}>
                <Text className="text-sm font-bold">
                  {t('bankImport.willImport', {count: preview.lines ?? 0, rejected: preview.rejectedCount ?? 0})}
                </Text>
                {preview.sample.map(l => (
                  <Text key={l.row} variant="caption">
                    {formatDisplayDate(l.date)} · {formatMoney(l.amount)}{l.utr ? ` · ${l.utr}` : ''}
                  </Text>
                ))}
                {(preview.rejected ?? []).slice(0, 5).map(r => (
                  <Text key={r.row} className="text-xs text-red-700">{t('recon.rejectedRow', {row: r.row, reason: r.reason})}</Text>
                ))}
                <Text variant="caption" className="mt-1">{t('bankImport.checkDates')}</Text>
              </View>
            ) : null}

            <Button testID="bank-import" title={t('bankImport.run')} className="mt-6" loading={busy}
              disabled={busy || !ready || !preview.lines} onPress={onImport} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
