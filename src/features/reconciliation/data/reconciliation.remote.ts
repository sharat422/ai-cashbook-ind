import {apiRequest} from '@api/client';

/**
 * Manual UPI/bank reconciliation. Nothing here collects or moves money; the
 * server only reads an uploaded statement and records a person's confirmations.
 *
 *   POST /api/v1/reconciliation/import       multipart `file` (.csv/.xlsx/.xls; PDF refused) -> ImportResult
 *   GET  /api/v1/reconciliation/suggestions  -> Suggestion[] (never auto-confirmed)
 *   POST /api/v1/reconciliation/confirm      {bankLineId, entryId} -> {bankLine, collection}
 *   GET  /api/v1/reconciliation/exceptions   -> Exceptions
 *   GET  /api/v1/daily-close?beat_id=&date=  -> DailyClose
 *
 * Money comes back as exact decimal strings ("1234.50"), not floats.
 */

export type Money = string;

export interface BankLine {
  id: string;
  date: string;
  amount: Money;
  utr: string | null;
  narration: string | null;
  /** What's not yet accounted for by matched collections ("0.00" = matched). */
  remaining: Money;
  matched: boolean;
}

export interface Collection {
  id: string;
  customerId: string;
  customerName: string;
  date: string;
  amount: Money;
  mode: string | null;
  reference: string | null;
  beatId: string | null;
  salesmanId: string | null;
}

export interface Suggestion {
  bankLine: BankLine;
  collection: Collection;
  /** 'utr': the UTR/reference matched too; 'amount_date': same amount, near date. */
  match: 'utr' | 'amount_date';
  dayGap: number;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  skipped: number;
  rejected: {row: number; reason: string}[];
  alreadyImported: boolean;
}

export interface Exceptions {
  bankLines: BankLine[];
  collections: Collection[];
  /** UPI payments an old app saved without a UTR; the owner adds it. */
  missingUtr: Collection[];
}

export const STATEMENT_COLUMNS = ['date', 'credit', 'debit', 'amount', 'drcr', 'utr', 'narration'] as const;
export type StatementColumn = (typeof STATEMENT_COLUMNS)[number];
export type StatementMapping = {headerRow: number} & Record<StatementColumn, number | null>;
export type DateFormat = 'auto' | 'DMY' | 'MDY' | 'YMD';

export interface StatementPreview {
  headerRow: number;
  headers: string[];
  rows: string[][];
  mapping: StatementMapping | null;
  dateFormat: DateFormat;
  needsMapping: boolean;
  lines?: number;
  skipped?: number;
  rejectedCount?: number;
  rejected?: {row: number; reason: string}[];
  sample?: {row: number; date: string; amount: Money; utr: string | null; narration: string | null}[];
}

export interface StatementImport {
  id: string;
  filename: string | null;
  createdAt: string;
  lines: number;
  from: string | null;
  to: string | null;
  deletedAt?: string | null;
}

/** Cash already taken to the bank ('deposit') or kept back in the shop ('float'). */
export interface CashDeposit {
  id: string;
  beatId: string | null;
  /** The salesperson whose cash it is; null = the whole beat. */
  userId?: string | null;
  date: string;
  kind: 'deposit' | 'float';
  amount: Money;
  note: string | null;
  bankLineId: string | null;
  matched: boolean;
}

export interface MatchedLine {
  bankLine: BankLine;
  collections: Collection[];
  /** A deposit line: the cash deposit it matches (no collections). */
  deposits?: CashDeposit[];
  confirmedAt: string;
}

export interface DailyClose {
  date: string;
  beatId: string | null;
  collections: (Collection & {verified: boolean})[];
  creditCollected: Money;
  cashInHand: Money;
  upiClaimed: Money;
  bankClaimed: Money;
  otherClaimed: Money;
  verified: Money;
  creditGiven: Money;
  /** creditCollected − cashInHand − verified; "0.00" once fully reconciled. */
  difference: Money;
  /** Latest physical cash count and counted − recorded (negative = short). */
  cashCounted: Money | null;
  cashOverShort: Money | null;
  cashCountedAt: string | null;
  /** Cash deposits matched to the bank, recorded but not in a statement yet, and cash kept back. */
  cashDeposited?: Money;
  cashDepositPending?: Money;
  cashKeptBack?: Money;
  deposits?: CashDeposit[];
  /** One close per beat: each salesperson's share of it. */
  members?: {userId: string | null; name: string | null; mobile: string | null;
    collected: Money; cash: Money; creditGiven: Money;
    /** This person's latest count and over/short (null: not counted, or not yours to see). */
    cashCounted?: Money | null; cashOverShort?: Money | null;
    /** Their deposits matched to the bank (null: not yours to see). */
    cashDeposited?: Money | null}[];
  /** True when cash is counted per salesperson (the beat figure is their sum). */
  cashCountByPerson?: boolean;
}

export interface StatementFile {
  uri: string;
  name: string;
  type: string;
}

function statementForm(file: StatementFile, mapping?: StatementMapping | null, dateFormat?: DateFormat): FormData {
  const form = new FormData();
  form.append('file', file as unknown as Blob);
  if (mapping) form.append('mapping', JSON.stringify(mapping));
  if (dateFormat && dateFormat !== 'auto') form.append('dateFormat', dateFormat);
  return form;
}

export const reconciliationRemote = {
  /** The mapping screen: columns we'd use and the first lines as read. Saves nothing. */
  preview: (file: StatementFile, mapping?: StatementMapping | null, dateFormat?: DateFormat) =>
    apiRequest<StatementPreview>('/reconciliation/preview', {
      method: 'POST', body: statementForm(file, mapping, dateFormat), timeoutMs: 60_000}),
  importStatement: (file: StatementFile, mapping?: StatementMapping | null, dateFormat?: DateFormat) =>
    apiRequest<ImportResult>('/reconciliation/import', {
      method: 'POST', body: statementForm(file, mapping, dateFormat), timeoutMs: 60_000}),
  imports: () => apiRequest<StatementImport[]>('/reconciliation/imports', {method: 'GET'}),
  deletedImports: () => apiRequest<StatementImport[]>('/reconciliation/imports?deleted=true', {method: 'GET'}),
  /** Lines come back unmatched; the owner re-confirms matches. A live statement: no-op. */
  restoreImport: (id: string) =>
    apiRequest<StatementImport & {restored: boolean}>(`/reconciliation/statements/${id}/restore`, {method: 'POST'}),
  deleteImport: (id: string) =>
    apiRequest<{deleted: boolean; lines: number; matchesUndone: number}>(`/reconciliation/imports/${id}`, {method: 'DELETE'}),
  candidates: (lineId: string, search: string) =>
    apiRequest<Collection[]>(`/reconciliation/lines/${lineId}/candidates?search=${encodeURIComponent(search)}`, {method: 'GET'}),
  match: (bankLineId: string, entryIds: string[]) =>
    apiRequest<{bankLine: BankLine; collections: Collection[]}>('/reconciliation/match', {
      method: 'POST', body: {bankLineId, entryIds}}),
  undo: (lineId: string) => apiRequest<BankLine>(`/reconciliation/lines/${lineId}/undo`, {method: 'POST'}),
  matched: () => apiRequest<MatchedLine[]>('/reconciliation/matched', {method: 'GET'}),
  addUtr: (customerId: string, entryId: string, utr: string) =>
    apiRequest<unknown>(`/customers/${customerId}/ledger/${entryId}/utr`, {method: 'PATCH', body: {utr}}),
  suggestions: () => apiRequest<Suggestion[]>('/reconciliation/suggestions', {method: 'GET'}),
  recordDeposit: (date: string, beatId: string | undefined, amount: string, kind: CashDeposit['kind'], userId?: string) =>
    apiRequest<CashDeposit>('/reconciliation/deposits', {
      method: 'POST', body: {date, beatId, amount, kind, userId: userId ?? null},
    }),
  deleteDeposit: (id: string) => apiRequest<{deleted: boolean}>(`/reconciliation/deposits/${id}`, {method: 'DELETE'}),
  depositLines: (id: string) => apiRequest<BankLine[]>(`/reconciliation/deposits/${id}/lines`, {method: 'GET'}),
  /** The bank line's remaining amount must equal the deposit; the server checks. */
  matchDeposit: (id: string, bankLineId: string) =>
    apiRequest<{deposit: CashDeposit; bankLine: BankLine}>(`/reconciliation/deposits/${id}/match`, {
      method: 'POST', body: {bankLineId}}),
  /** Open bank lines a collection can be split across. */
  lineCandidates: (entryId: string) =>
    apiRequest<BankLine[]>(`/reconciliation/collections/${entryId}/lines`, {method: 'GET'}),
  /** Other open bank lines to add to a match with this one. */
  otherLines: (lineId: string) =>
    apiRequest<BankLine[]>(`/reconciliation/lines/${lineId}/lines`, {method: 'GET'}),
  /** Several bank lines paying several collections; the server refuses unless every one is covered exactly. */
  matchMany: (bankLineIds: string[], entryIds: string[]) =>
    apiRequest<{bankLines: BankLine[]; collections: Collection[]}>('/reconciliation/confirm', {
      method: 'POST', body: {bankLineIds, entryIds}}),
  /** One collection across several bank lines; the server refuses unless they add up exactly. */
  split: (bankLineIds: string[], entryId: string) =>
    apiRequest<{bankLines: BankLine[]; collection: Collection}>('/reconciliation/confirm', {
      method: 'POST', body: {bankLineIds, entryId}}),
  confirm: (bankLineId: string, entryId: string) =>
    apiRequest<{bankLine: BankLine; collection: Collection}>('/reconciliation/confirm', {
      method: 'POST',
      body: {bankLineId, entryId},
    }),
  exceptions: () => apiRequest<Exceptions>('/reconciliation/exceptions', {method: 'GET'}),
  /** Record the cash physically counted; returns the day's close with over/short. */
  cashCount: (date: string, beatId: string | undefined, counted: string, userId?: string) =>
    apiRequest<DailyClose>('/daily-close/cash-count', {
      method: 'POST', body: {date, beatId: beatId ?? null, counted, userId: userId ?? null},
    }),
  dailyClose(date: string, beatId?: string): Promise<DailyClose> {
    const q = `date=${encodeURIComponent(date)}${beatId ? `&beat_id=${encodeURIComponent(beatId)}` : ''}`;
    return apiRequest<DailyClose>(`/daily-close?${q}`, {method: 'GET'});
  },
};
