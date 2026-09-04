import {describe, expect, it} from '@jest/globals';

import {
  appLanguageByLabel,
  DEFAULT_APP_LANGUAGE,
  getLanguageLabel,
  normalizePreferredLanguage,
} from './languagePreference';

describe('preferred language helpers', () => {
  it('defaults to English', () => {
    expect(DEFAULT_APP_LANGUAGE).toBe('en');
  });

  it('normalizes supported language codes', () => {
    expect(normalizePreferredLanguage('HI')).toBe('hi');
    expect(normalizePreferredLanguage('mr')).toBe('mr');
    expect(normalizePreferredLanguage('fr')).toBe('en');
  });

  it('labels languages in their own script', () => {
    expect(getLanguageLabel('hi')).toBe('हिन्दी');
    expect(getLanguageLabel('en')).toBe('English');
    expect(getLanguageLabel('ta')).toBe('தமிழ்');
  });

  it('resolves a picked label back to its code (round-trip)', () => {
    expect(appLanguageByLabel(getLanguageLabel('bn'))).toBe('bn');
    expect(appLanguageByLabel('unknown')).toBe('en');
  });
});
