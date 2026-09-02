import {collectDiagnostics, formatDiagnostics} from './collectDiagnostics';
import {useErrorLogStore} from './errorLog.store';

beforeEach(() => useErrorLogStore.setState({entries: []}));

describe('collectDiagnostics', () => {
  it('captures app/platform info and the pending-sync count, no secrets', () => {
    const d = collectDiagnostics();
    expect(d.appVersion).toBeTruthy();
    expect(d.platform).toBeTruthy();
    expect(typeof d.pendingSync).toBe('number');
    expect(d.screen).toMatch(/\d+×\d+/);
    // never leak a token or similar
    expect(JSON.stringify(d)).not.toMatch(/token|password/i);
  });

  it('includes recent errors so bug reports are actionable', () => {
    useErrorLogStore.getState().log('api GET /customers', new Error('500'));
    const d = collectDiagnostics();
    expect(d.recentErrors).toHaveLength(1);
    expect(d.recentErrors[0].context).toBe('api GET /customers');
  });

  it('formatDiagnostics renders a readable block for the email fallback', () => {
    const text = formatDiagnostics(collectDiagnostics());
    expect(text).toContain('Smart CashBook');
    expect(text).toContain('Platform:');
  });
});
