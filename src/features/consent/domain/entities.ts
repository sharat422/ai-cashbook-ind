/**
 * Consent domain. Each purpose is a distinct, independently-managed choice —
 * never a single bundled "agreed" flag. `core` is required to use the app;
 * `marketing` and `ai` are optional and opt-in (off by default).
 */
import type {TKey} from '@/i18n';

export const CONSENT_PURPOSES = ['core', 'marketing', 'ai'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Current choice for one purpose (server is the source of truth). */
export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean;
  required: boolean;
  /** Policy version the decision was made under (null = never decided). */
  policyVersion: string | null;
  /** ISO timestamp of the last change (null = never decided). */
  updatedAt: string | null;
}

export interface ConsentSnapshot {
  policyVersion: string;
  required: ConsentPurpose[];
  optional: ConsentPurpose[];
  consents: ConsentState[];
}

export interface ConsentChoice {
  purpose: ConsentPurpose;
  granted: boolean;
}

/** i18n keys for each purpose's label + explanation. */
export const CONSENT_COPY: Record<
  ConsentPurpose,
  {title: TKey; description: TKey}
> = {
  core: {title: 'consent.core.title', description: 'consent.core.desc'},
  marketing: {
    title: 'consent.marketing.title',
    description: 'consent.marketing.desc',
  },
  ai: {title: 'consent.ai.title', description: 'consent.ai.desc'},
};

/** True once the required purposes are granted under the current policy. */
export function hasRequiredConsent(snapshot: ConsentSnapshot | undefined): boolean {
  if (!snapshot) return false;
  return snapshot.consents.every(
    c =>
      !c.required ||
      (c.granted && c.policyVersion === snapshot.policyVersion),
  );
}

/** Whether AI features are permitted (AI consent granted). */
export function hasAiConsent(snapshot: ConsentSnapshot | undefined): boolean {
  return !!snapshot?.consents.find(c => c.purpose === 'ai')?.granted;
}
