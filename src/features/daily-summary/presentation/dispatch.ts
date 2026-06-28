import {dailySummaryUseCases} from '@features/daily-summary/di';
import {
  formatSummaryMessage,
  formatSummaryTitle,
} from '@features/daily-summary/domain/format';
import {useSummarySettingsStore} from '@features/daily-summary/presentation/store/summarySettings.store';
import {notificationService} from '@/services/notifications';
import {toISODate} from '@utils/date';

/**
 * Generate today's summary and deliver it through every available channel
 * (in-app today; WhatsApp once enabled), then record that today is done.
 */
export async function sendDailySummaryNow(): Promise<string[]> {
  const date = toISODate(new Date());
  const summary = await dailySummaryUseCases.getForDate(date);
  const delivered = await notificationService.notify({
    title: formatSummaryTitle(summary),
    body: formatSummaryMessage(summary),
    data: {type: 'daily-summary', date},
  });
  useSummarySettingsStore.getState().setLastSentDate(date);
  return delivered;
}

/** True when the summary is enabled, not yet sent today, and past its time. */
export function isSummaryDue(now: Date = new Date()): boolean {
  const {enabled, hour, minute, lastSentDate} =
    useSummarySettingsStore.getState();
  if (!enabled) return false;
  if (lastSentDate === toISODate(now)) return false;
  const dueMinutes = hour * 60 + minute;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= dueMinutes;
}

/** Fire the summary if it's due — safe to call repeatedly. */
export async function maybeSendDailySummary(): Promise<void> {
  if (isSummaryDue()) {
    await sendDailySummaryNow();
  }
}
