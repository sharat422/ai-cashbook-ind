import {
  formatErrorLog,
  logError,
  useErrorLogStore,
} from './errorLog.store';

beforeEach(() => useErrorLogStore.setState({entries: []}));

describe('errorLog store', () => {
  it('records the newest error first with context + message', () => {
    logError('api GET /customers', new Error('boom'));
    const [entry] = useErrorLogStore.getState().entries;
    expect(entry.context).toBe('api GET /customers');
    expect(entry.message).toBe('boom');
    expect(entry.at).toBeTruthy();
  });

  it('appends extra detail and handles non-Error values', () => {
    logError('render', 'a string failure', 'at DashboardScreen');
    expect(useErrorLogStore.getState().entries[0].message).toBe(
      'a string failure — at DashboardScreen',
    );
  });

  it('dedups an identical error fired in a burst (e.g. query retries)', () => {
    logError('api GET /x', new Error('timeout'));
    logError('api GET /x', new Error('timeout'));
    logError('api GET /x', new Error('timeout'));
    expect(useErrorLogStore.getState().entries).toHaveLength(1);
  });

  it('keeps only the most recent 50', () => {
    for (let i = 0; i < 60; i++) {
      logError('ctx', new Error(`e${i}`)); // distinct messages → not deduped
    }
    const {entries} = useErrorLogStore.getState();
    expect(entries).toHaveLength(50);
    expect(entries[0].message).toBe('e59'); // newest first
  });

  it('clear() empties the log', () => {
    logError('ctx', new Error('x'));
    useErrorLogStore.getState().clear();
    expect(useErrorLogStore.getState().entries).toEqual([]);
  });

  it('formatErrorLog produces shareable text', () => {
    expect(formatErrorLog([])).toBe('No errors logged.');
    logError('api POST /voice/parse', new Error('502'));
    const text = formatErrorLog(useErrorLogStore.getState().entries);
    expect(text).toContain('api POST /voice/parse');
    expect(text).toContain('502');
  });
});
