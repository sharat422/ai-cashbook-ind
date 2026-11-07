/**
 * Statement-of-account computation over a date range, derived from the full
 * ledger. Pure logic — the running balances continue across the range so the
 * opening/closing figures are correct.
 */
import {tNow, type TKey} from '@/i18n';
import type {CustomerLedger, LedgerEntryView} from './ledger';

export interface CustomerStatement {
  from: string;
  to: string;
  /** Balance carried into the range (running balance just before `from`). */
  openingBalance: number;
  /** Balance at the end of the range. */
  closingBalance: number;
  /** Credit + payment totals within the range. */
  totalCredit: number;
  totalPayment: number;
  /** Current overall outstanding (whole ledger). */
  outstanding: number;
  /** In-range entries, oldest first, each with its overall running balance. */
  rows: LedgerEntryView[];
}

/**
 * Build a statement for [from, to] (inclusive ISO dates). Uses the overall
 * running balances already on `ledger.entries` so opening = balance just before
 * the range and closing = balance of the last in-range entry.
 */
export function buildStatement(
  ledger: CustomerLedger,
  from: string,
  to: string,
): CustomerStatement {
  // ledger.entries is newest-first; reverse to oldest-first.
  const asc = [...ledger.entries].reverse();

  const before = asc.filter(e => e.date < from);
  const openingBalance = before.length
    ? before[before.length - 1].balance
    : 0;

  const rows = asc.filter(e => e.date >= from && e.date <= to);
  const closingBalance = rows.length
    ? rows[rows.length - 1].balance
    : openingBalance;

  let totalCredit = 0;
  let totalPayment = 0;
  for (const e of rows) {
    if (e.type === 'credit') totalCredit += e.amount;
    else totalPayment += e.amount;
  }

  return {
    from,
    to,
    openingBalance,
    closingBalance,
    totalCredit,
    totalPayment,
    outstanding: ledger.outstanding,
    rows,
  };
}

/**
 * CSV version (Excel-importable). Plain numbers, no currency symbol; labels in
 * the user's language, with a BOM so Excel reads Telugu/Hindi as UTF-8.
 */
export function statementToCsv(statement: CustomerStatement): string {
  const L = (k: string) => csvCell(tNow(`statement.doc.${k}` as TKey));
  const rows: string[] = [[L('date'), L('type'), L('amount'), L('balance')].join(',')];
  rows.push(`${L('opening')},,,${statement.openingBalance}`);
  statement.rows.forEach(e => {
    const type = e.type === 'credit' ? L('credit') : L('payment');
    rows.push(`${e.date},${type},${e.amount},${e.balance}`);
  });
  rows.push(`${L('closing')},,,${statement.closingBalance}`);
  rows.push(`${L('totalCredit')},,${statement.totalCredit},`);
  rows.push(`${L('totalReceived')},,${statement.totalPayment},`);
  rows.push(`${L('outstanding')},,,${statement.outstanding}`);
  return '\uFEFF' + rows.join('\n');
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
