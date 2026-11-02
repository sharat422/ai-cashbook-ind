/**
 * Ask AI text helpers. Muse returns no confidence score, so "didn't catch
 * that" is decided from the text itself; the user always sees and can edit
 * the transcript before it is sent.
 */

/** True when a transcript is too thin to send: empty, no letters, or one word. */
export function isUnclearTranscript(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(w => /\p{L}/u.test(w));
  return words.length < 2;
}

export interface AnswerSegment {
  text: string;
  /** Amounts and dates, shown bold so the key facts stand out. */
  strong: boolean;
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const KEY_FACT = new RegExp(
  [
    '(?:₹|Rs\\.?\\s?)\\s?\\d[\\d,]*(?:\\.\\d+)?', // ₹1,999.90 / Rs 500
    `\\b\\d{1,2}\\s(?:${MONTHS})[a-z]*(?:\\s\\d{4})?\\b`, // 2 Sep 2026
    '\\b\\d{4}-\\d{2}-\\d{2}\\b', // 2026-09-02
  ].join('|'),
  'g',
);

/** Split an answer into plain and strong (amount/date) segments. */
export function highlightKeyFacts(answer: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of answer.matchAll(KEY_FACT)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({text: answer.slice(last, start), strong: false});
    segments.push({text: match[0], strong: true});
    last = start + match[0].length;
  }
  if (last < answer.length) segments.push({text: answer.slice(last), strong: false});
  return segments;
}

const CHAT_LANGUAGES = ['en', 'hi', 'te', 'ta', 'ml'] as const;

/**
 * Ask AI language hint from the app's language setting. Languages Ask AI has
 * no fixed replies for get no hint: the model then matches the question.
 */
export function chatLanguageHint(
  appLanguage: string,
): (typeof CHAT_LANGUAGES)[number] | undefined {
  return (CHAT_LANGUAGES as readonly string[]).includes(appLanguage)
    ? (appLanguage as (typeof CHAT_LANGUAGES)[number])
    : undefined;
}

/** "0:07 / 1:00" for the recording indicator. */
export function formatRecordingTime(elapsedMs: number, maxMs: number): string {
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  return `${fmt(Math.min(elapsedMs, maxMs))} / ${fmt(maxMs)}`;
}
