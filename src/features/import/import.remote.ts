import {apiRequest} from '@api/client';

export const IMPORT_FIELDS = ['date', 'retailer', 'billRef', 'amount', 'type', 'opening'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Record<ImportField, number | null>;

export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

/** Row problems are codes, shown via t('import.reason.<code>'). */
export interface ImportPreview {
  fileName: string;
  headers: string[];
  headerRow: number;
  mapping: Mapping;
  missing: ImportField[];
  rowCount: number;
  toImport: number;
  skipped: number;
  newRetailers: string[];
  duplicateCount: number;
  duplicates: {row: number; retailer: string; billRef: string; amount: number; date: string; against: 'file' | 'books'}[];
  issueCount: number;
  issues: {row: number; reason: string}[];
  openingTotal: number;
  udharTotal: number;
  jamaTotal: number;
}

export interface ImportLogEntry {
  id: string;
  createdAt: string;
  fileName: string;
  rowsImported: number;
  rowsSkipped: number;
  newRetailers: number;
  importedBy: string;
}

function form(file: PickedFile, mapping?: Mapping): FormData {
  const f = new FormData();
  f.append('file', file as unknown as Blob);
  if (mapping) f.append('mapping', JSON.stringify(mapping));
  return f;
}

export const importRemote = {
  /** Dry run: the server reads the file and saves nothing. */
  preview: (file: PickedFile, mapping?: Mapping) =>
    apiRequest<ImportPreview>('/imports/preview', {method: 'POST', body: form(file, mapping), timeoutMs: 60_000}),
  run: (file: PickedFile, mapping: Mapping) =>
    apiRequest<ImportLogEntry>('/imports', {method: 'POST', body: form(file, mapping), timeoutMs: 120_000}),
  history: () => apiRequest<ImportLogEntry[]>('/imports', {method: 'GET'}),
};
