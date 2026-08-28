/**
 * Parser for Indian bank transaction SMS (SBI, HDFC, ICICI, Axis, Kotak, …).
 *
 * Pure + dependency-free so it is fully unit-testable and works on any input
 * source — a native inbox read (Android), a shared message, or pasted text.
 * It never saves anything; it only extracts a best-effort transaction that the
 * user reviews and confirms.
 *
 * Extraction is deliberately tolerant: if it can find an amount and a direction
 * (debit/credit) it returns a candidate; date/merchant are best-effort and
 * editable downstream. Anything it can't read at all returns `null`.
 */

export type TxnDirection = 'debit' | 'credit';
export type BankName = 'SBI' | 'HDFC' | 'ICICI' | 'Axis' | 'Kotak';

export interface ParsedBankSms {
  /** Amount in rupees (> 0). */
  amount: number;
  /** debit = money out (→ expense); credit = money in (→ income). */
  direction: TxnDirection;
  /** ISO date (YYYY-MM-DD) when found in the message, else null. */
  date: string | null;
  /** Best-effort merchant / counterparty, else null. */
  merchant: string | null;
  /** Recognised bank, else null. */
  bank: BankName | null;
  /** Last 3–4 digits of the account/card, else null. */
  accountTail: string | null;
  /** The original message, kept for the audit trail + user reference. */
  rawText: string;
}

const BANK_PATTERNS: Array<{bank: BankName; re: RegExp}> = [
  {bank: 'SBI', re: /\bSBI\b|State Bank/i},
  {bank: 'HDFC', re: /\bHDFC\b/i},
  {bank: 'ICICI', re: /\bICICI\b/i},
  {bank: 'Axis', re: /\bAxis\b/i},
  {bank: 'Kotak', re: /\bKotak\b/i},
];

// Words that flag an amount as a *balance/limit*, not the transaction amount.
const NON_TXN_AMOUNT_CONTEXT = /(bal|balance|avl|available|lmt|limit)\D{0,6}$/i;

const DEBIT_RE = /\b(debited|debit|spent|sent|withdrawn|paid|purchase|deducted)\b/i;
const CREDIT_RE = /\b(credited|credit|received|deposited|added)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Quick pre-filter: does this look like a bank transaction SMS at all? */
export function isLikelyBankSms(text: string): boolean {
  if (!text || !/(rs\.?|inr|₹)/i.test(text)) return false;
  return DEBIT_RE.test(text) || CREDIT_RE.test(text);
}

function detectBank(text: string): BankName | null {
  for (const {bank, re} of BANK_PATTERNS) if (re.test(text)) return bank;
  return null;
}

function parseAmountToken(token: string): number {
  return Number(token.replace(/,/g, ''));
}

/** Pick the transaction amount, skipping balance/limit amounts where possible. */
function extractAmount(text: string): number | null {
  const re = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  const candidates: number[] = [];
  let firstOverall: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseAmountToken(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (firstOverall === null) firstOverall = value;
    const before = text.slice(Math.max(0, m.index - 14), m.index);
    if (!NON_TXN_AMOUNT_CONTEXT.test(before)) candidates.push(value);
  }
  return candidates.length > 0 ? candidates[0] : firstOverall;
}

function extractDirection(text: string): TxnDirection | null {
  const debit = DEBIT_RE.exec(text);
  const credit = CREDIT_RE.exec(text);
  if (debit && credit) {
    // Both present (e.g. "A/c debited … merchant credited") — the action on the
    // user's account is stated first, so the earlier keyword wins.
    return debit.index <= credit.index ? 'debit' : 'credit';
  }
  if (debit) return 'debit';
  if (credit) return 'credit';
  return null;
}

function clampTwoDigitYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Extract a date in the many shapes Indian banks use; null if none found. */
function extractDate(text: string): string | null {
  // YYYY-MM-DD
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD-Mon-YY / DD Mon YYYY / DDMonYY (e.g. 05-Aug-26, 05Aug26, 05 Aug 2026)
  m = /(\d{1,2})[-\s]?([A-Za-z]{3})[A-Za-z]*[-\s]?(\d{2,4})/.exec(text);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return iso(clampTwoDigitYear(Number(m[3])), mo, Number(m[1]));
  }

  // DD-MM-YY / DD/MM/YYYY (Indian day-first ordering)
  m = /(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(text);
  if (m) {
    return iso(clampTwoDigitYear(Number(m[3])), Number(m[2]), Number(m[1]));
  }
  return null;
}

function cleanMerchant(raw: string): string | null {
  // Stop at the next clause / keyword that clearly isn't part of the name.
  let s = raw.split(
    /\b(?:on|ref|refno|upi|vpa|neft|imps|rtgs|avl|avbl|info|not you|call|a\/c|ac|acct|account|dated|txn|id|bal|using|card)\b/i,
  )[0];
  s = s.split(';')[0];
  // Collapse whitespace, trim, then strip trailing punctuation (period, comma…).
  s = s.replace(/\s{2,}/g, ' ').trim().replace(/[.,;:\-–]+$/g, '').trim();
  if (!s || s.length < 2 || s.length > 40) return null;
  return s;
}

/**
 * Best-effort merchant / counterparty. Fuzzy — the user can edit it downstream.
 * Direction matters: on a debit the counterparty is the payee ("to X"); on a
 * credit it's the sender ("from X"). Patterns are tried in priority order.
 */
function extractMerchant(text: string, direction: TxnDirection): string | null {
  const patterns =
    direction === 'debit'
      ? [
          /(?:to vpa|vpa)\s+(\S+)/i, // UPI id, e.g. ramesh@okhdfc
          /\b(?:transfer to|sent to|paid to|to)\s+([A-Za-z0-9@][^\n]*)/i,
          /\bat\s+([A-Za-z0-9][^\n]*)/i, // card spend "at MERCHANT"
          /;\s*([^;]+?)\s+credited\b/i, // ICICI transfer "; PAYEE credited"
        ]
      : [
          /(?:received from|from)\s+([A-Za-z0-9@][^\n]*)/i,
          /(?:credited by|by)\s+([A-Za-z0-9@][^\n]*)/i,
        ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const cleaned = cleanMerchant(m[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function extractAccountTail(text: string): string | null {
  const m =
    /(?:a\/c|ac|acct|account|card|ending)\s*(?:no\.?|number)?\s*[xX*#]*\s*(\d{3,4})\b/i.exec(
      text,
    );
  return m ? m[1] : null;
}

/**
 * Parse a single SMS into a transaction candidate, or null if it isn't a
 * recognisable bank transaction. Requires at minimum an amount + direction.
 */
export function parseBankSms(text: string): ParsedBankSms | null {
  if (!text || typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/g, ' ').trim();

  const amount = extractAmount(normalized);
  const direction = extractDirection(normalized);
  if (amount === null || direction === null) return null;

  return {
    amount,
    direction,
    date: extractDate(normalized),
    merchant: extractMerchant(normalized, direction),
    bank: detectBank(normalized),
    accountTail: extractAccountTail(normalized),
    rawText: text.trim(),
  };
}

/** Parse many messages, keeping only recognisable bank transactions. */
export function parseBankMessages(messages: string[]): ParsedBankSms[] {
  const out: ParsedBankSms[] = [];
  for (const msg of messages) {
    const parsed = parseBankSms(msg);
    if (parsed) out.push(parsed);
  }
  return out;
}
