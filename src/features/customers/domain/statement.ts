import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';
import type {Customer} from './entities';
import type {CustomerLedger} from './ledger';

/**
 * Plain-text account statement — used for "Download / share statement" and as a
 * base for any future PDF export. Entries are listed oldest → newest with the
 * running balance, matching a printed ledger.
 */
export function formatStatement(
  customer: Customer,
  ledger: CustomerLedger,
): string {
  const lines: string[] = [
    `STATEMENT OF ACCOUNT`,
    customer.businessName
      ? `${customer.fullName} (${customer.businessName})`
      : customer.fullName,
    `Mobile: +91 ${customer.mobile}`,
    customer.gstNumber ? `GSTIN: ${customer.gstNumber}` : '',
    ``,
    `Date        Type      Amount        Balance`,
    `------------------------------------------------`,
  ].filter(Boolean);

  // Oldest → newest for a statement (ledger.entries is newest-first).
  [...ledger.entries].reverse().forEach(e => {
    const date = formatDisplayDate(e.date).padEnd(12, ' ');
    const type = (e.type === 'credit' ? 'Credit' : 'Payment').padEnd(9, ' ');
    const amount = `${e.type === 'credit' ? '+' : '-'}${formatINR(e.amount)}`.padEnd(13, ' ');
    lines.push(`${date}${type}${amount}${formatINR(e.balance)}`);
  });

  lines.push(`------------------------------------------------`);
  lines.push(`Total credit:  ${formatINR(ledger.totalCredit)}`);
  lines.push(`Total received: ${formatINR(ledger.totalPayment)}`);
  lines.push(`Outstanding:    ${formatINR(ledger.outstanding)}`);
  return lines.join('\n');
}

/** Friendly payment-reminder message sent to the customer (WhatsApp/SMS). */
export function formatReminderMessage(
  customer: Customer,
  outstanding: number,
): string {
  return (
    `Hi ${customer.fullName.split(' ')[0]}, this is a gentle reminder that ` +
    `${formatINR(outstanding)} is outstanding on your account. ` +
    `Please clear it at your convenience. Thank you!`
  );
}
