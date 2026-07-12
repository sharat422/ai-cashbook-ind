import {
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
    expect(normalizePreferredLanguage('fr')).toBe('en');
  });

  it('returns user-friendly labels for supported languages', () => {
    expect(getLanguageLabel('hi')).toBe('Hindi');
    expect(getLanguageLabel('en')).toBe('English');
  });
});
