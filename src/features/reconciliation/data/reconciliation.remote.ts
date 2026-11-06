import {apiRequest} from '@api/client';

/**
 * Manual UPI/bank reconciliation. Nothing here collects or moves money; the
 * server only reads an uploaded statement and records a person's confirmations.
 *
 *   POST /api/v1/reconciliation/import       multipart `file` (.csv/.xlsx) -> ImportResult
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
  matchedEntryId: string | null;
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
}

export interface StatementFile {
  uri: string;
  name: string;
  type: string;
}

export const reconciliationRemote = {
  importStatement(file: StatementFile): Promise<ImportResult> {
    const form = new FormData();
    form.append('file', file as unknown as Blob);
    return apiRequest<ImportResult>('/reconciliation/import', {method: 'POST', body: form, timeoutMs: 60_000});
  },
  suggestions: () => apiRequest<Suggestion[]>('/reconciliation/suggestions', {method: 'GET'}),
  confirm: (bankLineId: string, entryId: string) =>
    apiRequest<{bankLine: BankLine; collection: Collection}>('/reconciliation/confirm', {
      method: 'POST',
      body: {bankLineId, entryId},
    }),
  exceptions: () => apiRequest<Exceptions>('/reconciliation/exceptions', {method: 'GET'}),
  dailyClose(date: string, beatId?: string): Promise<DailyClose> {
    const q = `date=${encodeURIComponent(date)}${beatId ? `&beat_id=${encodeURIComponent(beatId)}` : ''}`;
    return apiRequest<DailyClose>(`/daily-close?${q}`, {method: 'GET'});
  },
};
