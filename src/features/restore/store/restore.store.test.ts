import {useRestoreStore} from './restore.store';

describe('restore.store', () => {
  beforeEach(() => {
    useRestoreStore.setState({decided: {}});
  });

  it('offers restore for an account never seen on this device (fresh install)', () => {
    expect(useRestoreStore.getState().needsDecision('biz-1')).toBe(true);
  });

  it('does not offer when there is no business yet', () => {
    expect(useRestoreStore.getState().needsDecision(null)).toBe(false);
    expect(useRestoreStore.getState().needsDecision(undefined)).toBe(false);
  });

  it('stops offering once a decision is recorded', () => {
    useRestoreStore.getState().markDecided('biz-1', 'restored');
    expect(useRestoreStore.getState().needsDecision('biz-1')).toBe(false);
    // A different account is still offered independently.
    expect(useRestoreStore.getState().needsDecision('biz-2')).toBe(true);
  });

  it('skipping also counts as decided (no nagging)', () => {
    useRestoreStore.getState().markDecided('biz-1', 'skipped');
    expect(useRestoreStore.getState().needsDecision('biz-1')).toBe(false);
  });

  it('reset re-offers restore (Settings "restore data")', () => {
    useRestoreStore.getState().markDecided('biz-1', 'skipped');
    useRestoreStore.getState().reset('biz-1');
    expect(useRestoreStore.getState().needsDecision('biz-1')).toBe(true);
  });
});
