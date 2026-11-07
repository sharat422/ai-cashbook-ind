import {describe, expect, it} from '@jest/globals';

import {
  appLanguageByLabel,
  DEFAULT_APP_LANGUAGE,
  getLanguageLabel,
  normalizePreferredLanguage,
} from './languagePreference';

// jest.setup.js keeps tests in English; check the real default here.
jest.unmock('./languagePreference');

describe('preferred language helpers', () => {
  it('defaults to Telugu', () => {
    expect(DEFAULT_APP_LANGUAGE).toBe('te');
  });

  it('normalizes supported language codes', () => {
    expect(normalizePreferredLanguage('HI')).toBe('hi');
    expect(normalizePreferredLanguage('mr')).toBe('mr');
    expect(normalizePreferredLanguage('fr')).toBe('te');
    expect(normalizePreferredLanguage('Hinglish')).toBe('hinglish');
  });

  it('labels languages in their own script', () => {
    expect(getLanguageLabel('hi')).toBe('हिन्दी');
    expect(getLanguageLabel('en')).toBe('English');
    expect(getLanguageLabel('ta')).toBe('தமிழ்');
  });

  it('resolves a picked label back to its code (round-trip)', () => {
    expect(appLanguageByLabel(getLanguageLabel('bn'))).toBe('bn');
    expect(appLanguageByLabel('unknown')).toBe('te');
    expect(appLanguageByLabel('Hinglish')).toBe('hinglish');
  });
});
