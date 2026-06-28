import {formatINR} from '@utils/currency';
import {formatDisplayDate} from '@utils/date';
import type {DailySummary} from './entities';

/**
 * Render a summary as a short, human-readable message. Used as the body of the
 * in-app notification today, and as the WhatsApp message text later — both
 * channels share this single source of truth.
 */
export function formatSummaryMessage(summary: DailySummary): string {
  const profitLabel = summary.profit >= 0 ? 'Profit' : 'Loss';
  const lines = [
    `📊 Daily Summary — ${formatDisplayDate(summary.date)}`,
    `Income: ${formatINR(summary.income)}`,
    `Expense: ${formatINR(summary.expense)}`,
    `${profitLabel}: ${formatINR(Math.abs(summary.profit))}`,
  ];

  if (summary.topExpenseCategories.length > 0) {
    const top = summary.topExpenseCategories
      .slice(0, 3)
      .map(c => `${c.category} ${formatINR(c.amount)}`)
      .join(', ');
    lines.push(`Top spend: ${top}`);
  }

  return lines.join('\n');
}

/** Short one-line title for the notification. */
export function formatSummaryTitle(summary: DailySummary): string {
  const sign = summary.profit >= 0 ? '🟢' : '🔴';
  const label = summary.profit >= 0 ? 'profit' : 'loss';
  return `${sign} Today: ${formatINR(Math.abs(summary.profit))} ${label}`;
}
