/**
 * Statement-of-account computation over a date range, derived from the full
 * ledger. Pure logic — the running balances continue across the range so the
 * opening/closing figures are correct.
 */
import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';
import type {Customer} from './entities';
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

/** WhatsApp / share-friendly text version of the statement. */
export function statementToText(
  customer: Customer,
  statement: CustomerStatement,
): string {
  const lines = [
    `STATEMENT — ${customer.fullName}`,
    `${formatDisplayDate(statement.from)} to ${formatDisplayDate(statement.to)}`,
    ``,
    `Opening balance: ${formatINR(statement.openingBalance)}`,
  ];
  statement.rows.forEach(e => {
    const sign = e.type === 'credit' ? '+' : '-';
    lines.push(
      `${formatDisplayDate(e.date)}  ${sign}${formatINR(e.amount)}  (bal ${formatINR(e.balance)})`,
    );
  });
  lines.push(
    ``,
    `Total credit: ${formatINR(statement.totalCredit)}`,
    `Total received: ${formatINR(statement.totalPayment)}`,
    `Closing balance: ${formatINR(statement.closingBalance)}`,
    `Outstanding: ${formatINR(statement.outstanding)}`,
  );
  return lines.join('\n');
}

/** CSV version (Excel-importable). Plain numbers, no currency symbol. */
export function statementToCsv(statement: CustomerStatement): string {
  const rows: string[] = ['Date,Type,Amount,Balance'];
  rows.push(`Opening Balance,,,${statement.openingBalance}`);
  statement.rows.forEach(e => {
    const type = e.type === 'credit' ? 'Credit' : 'Payment';
    rows.push(`${e.date},${type},${e.amount},${e.balance}`);
  });
  rows.push(`Closing Balance,,,${statement.closingBalance}`);
  rows.push(`Total Credit,,${statement.totalCredit},`);
  rows.push(`Total Received,,${statement.totalPayment},`);
  rows.push(`Outstanding,,,${statement.outstanding}`);
  return rows.join('\n');
}
