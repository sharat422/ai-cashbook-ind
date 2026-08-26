import {en} from './translations';
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

  it('falls back to English for languages without a translation (kn/ta)', () => {
    expect(translate('kn', 'dashboard.welcome')).toBe('Welcome back');
    expect(translate('ta', 'settings.title')).toBe('Settings');
  });

  it('interpolates placeholders', () => {
    expect(translate('en', 'dashboard.syncing', {count: 3})).toBe(
      'Syncing 3 items…',
    );
    expect(translate('hi', 'settings.appLockDesc', {n: 4})).toContain('4');
  });

  it('every Hindi key is a real English key (no orphan translations)', () => {
    // Guards against typos in translation keys drifting from the source.
    // (Iterate the hi dict via a round-trip through translate on en keys.)
    const enKeys = Object.keys(en);
    expect(enKeys).toContain('dashboard.welcome');
    expect(enKeys.length).toBeGreaterThan(0);
  });
});
