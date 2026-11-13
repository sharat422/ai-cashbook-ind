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
  /** IM7: when it was undone (it can't be undone twice). */
  undoneAt?: string | null;
  canUndo?: boolean;
  /** Why it can't be undone: work done since rests on it. */
  blockers?: UndoBlocker[];
}

export type UndoBlocker =
  | {reason: 'later_import'; file: string}
  | {reason: 'entry_used'; row: number | null; retailer: string; amount: number; date: string}
  | {reason: 'retailer_edited' | 'retailer_used'; retailer: string};

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
  /** Owner only (IM7): removes exactly what that import added. */
  undo: (id: string) => apiRequest<ImportLogEntry>(`/imports/${id}/undo`, {method: 'POST', timeoutMs: 60_000}),
};
