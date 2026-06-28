import {formatINR} from '@utils/currency';
import {
  recommendTone,
  TONE_ORDER,
  type CollectionInput,
  type CollectionMessage,
  type Language,
} from './entities';
import {TEMPLATES} from './templates';

function render(template: string, input: CollectionInput): string {
  return template
    .replace(/\{name\}/g, input.name.trim() || 'there')
    .replace(/\{amount\}/g, formatINR(Math.max(input.outstandingAmount, 0)))
    .replace(/\{days\}/g, String(Math.max(input.daysOverdue, 0)));
}

/**
 * Generate the three personalized collection messages (friendly / professional
 * / urgent) in the chosen language, flagging the recommended tone.
 */
export function generateMessages(
  input: CollectionInput,
  language: Language,
): CollectionMessage[] {
  const recommended = recommendTone(input);
  return TONE_ORDER.map(tone => ({
    tone,
    text: render(TEMPLATES[language][tone], input),
    recommended: tone === recommended,
  }));
}
