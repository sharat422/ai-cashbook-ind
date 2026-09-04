import {en, translations, type TKey} from './translations';
import {translate} from './useT';

describe('translate', () => {
  it('returns the English source string', () => {
    expect(translate('en', 'dashboard.welcome')).toBe('Welcome back');
  });

  it('returns the Hindi translation when language is hi', () => {
    expect(translate('hi', 'dashboard.welcome')).toBe('वापसी पर स्वागत है');
    expect(translate('hi', 'common.logout')).toBe('लॉग आउट');
  });

  it('returns the Telugu translation when language is te', () => {
    expect(translate('te', 'dashboard.welcome')).toBe('తిరిగి స్వాగతం');
    expect(translate('te', 'settings.title')).toBe('సెట్టింగ్‌లు');
  });

  it('falls back to English, then the raw key, when a translation is missing', () => {
    // Unknown key → returns the key itself (last-resort fallback).
    expect(translate('hi', 'this.key.does.not.exist' as TKey)).toBe(
      'this.key.does.not.exist',
    );
    // For every target locale, any key it hasn't translated yet resolves to the
    // English source. (Stays valid whether a locale is empty, partial, or full —
    // once fully translated the loop simply finds nothing to assert.)
    const enJson = en as Record<string, string>;
    const targets = ['hi', 'te', 'ta', 'kn', 'mr', 'gu', 'bn', 'ml', 'pa'] as const;
    for (const lang of targets) {
      const missing = Object.keys(enJson).find(k => !(k in translations[lang]!));
      if (missing) expect(translate(lang, missing as TKey)).toBe(enJson[missing]);
    }
  });

  it('interpolates placeholders', () => {
    expect(translate('en', 'dashboard.syncing', {count: 3})).toBe(
      'Syncing 3 items…',
    );
    expect(translate('hi', 'settings.appLockDesc', {n: 4})).toContain('4');
  });

  it('every hi/te translation key is a real English key (no orphans/typos)', () => {
    // Guards the growing translation tables: a mistyped key would silently fall
    // back to English forever, so fail loudly if a hi/te key isn't in the source.
    const enKeys = new Set(Object.keys(en));
    for (const lang of ['hi', 'te'] as const) {
      for (const key of Object.keys(translations[lang])) {
        expect({lang, key, known: enKeys.has(key)}).toEqual({
          lang,
          key,
          known: true,
        });
      }
    }
  });
});
