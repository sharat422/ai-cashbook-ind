/**
 * Domain types for the AI Collection Assistant. Pure — no framework imports.
 */

export type CollectionTone = 'friendly' | 'professional' | 'urgent';

export const TONE_ORDER: CollectionTone[] = [
  'friendly',
  'professional',
  'urgent',
];

export const TONE_LABEL: Record<CollectionTone, string> = {
  friendly: 'Friendly',
  professional: 'Professional',
  urgent: 'Urgent',
};

export const TONE_ICON: Record<CollectionTone, string> = {
  friendly: '😊',
  professional: '📄',
  urgent: '⚠️',
};

export type Language = 'en' | 'hi' | 'kn' | 'ta' | 'te';

export const LANGUAGE_ORDER: Language[] = ['en', 'hi', 'kn', 'ta', 'te'];

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: 'English',
  hi: 'हिंदी',
  kn: 'ಕನ್ನಡ',
  ta: 'தமிழ்',
  te: 'తెలుగు',
};

/** Inputs the assistant personalizes the message from. */
export interface CollectionInput {
  name: string;
  outstandingAmount: number;
  daysOverdue: number;
  /** 0 (new/weak) – 100 (long, trusted) relationship. */
  relationshipScore: number;
}

export interface CollectionMessage {
  tone: CollectionTone;
  text: string;
  /** True for the tone the assistant recommends for this situation. */
  recommended: boolean;
}

export type RelationshipLevel = 'strong' | 'neutral' | 'weak';

export function relationshipLevel(score: number): RelationshipLevel {
  if (score >= 66) return 'strong';
  if (score >= 33) return 'neutral';
  return 'weak';
}

export function scoreForLevel(level: RelationshipLevel): number {
  return level === 'strong' ? 80 : level === 'neutral' ? 50 : 20;
}

/**
 * Recommend a tone from the situation: be gentle with good relationships /
 * recently due; escalate when long overdue with a weak relationship.
 */
export function recommendTone(input: CollectionInput): CollectionTone {
  if (input.daysOverdue <= 7 || input.relationshipScore >= 70) {
    return 'friendly';
  }
  if (input.daysOverdue >= 30 && input.relationshipScore < 40) {
    return 'urgent';
  }
  return 'professional';
}
