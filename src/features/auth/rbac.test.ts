import {PERMISSIONS, roleCan} from './rbac';

describe('roleCan — mirrors the backend matrix', () => {
  it('owner can do everything', () => {
    for (const p of Object.values(PERMISSIONS)) {
      expect(roleCan('owner', p)).toBe(true);
    }
  });

  it('accountant: view + export + add/edit, but NOT delete/settings/team', () => {
    expect(roleCan('accountant', PERMISSIONS.DATA_VIEW)).toBe(true);
    expect(roleCan('accountant', PERMISSIONS.REPORTS_VIEW)).toBe(true);
    expect(roleCan('accountant', PERMISSIONS.REPORTS_EXPORT)).toBe(true);
    expect(roleCan('accountant', PERMISSIONS.ENTRY_CREATE)).toBe(true);
    expect(roleCan('accountant', PERMISSIONS.ENTRY_EDIT)).toBe(true);
    expect(roleCan('accountant', PERMISSIONS.ENTRY_DELETE)).toBe(false);
    expect(roleCan('accountant', PERMISSIONS.SETTINGS_MANAGE)).toBe(false);
    expect(roleCan('accountant', PERMISSIONS.TEAM_MANAGE)).toBe(false);
  });

  it('staff: add entries only', () => {
    expect(roleCan('staff', PERMISSIONS.ENTRY_CREATE)).toBe(true);
    for (const p of Object.values(PERMISSIONS)) {
      if (p !== PERMISSIONS.ENTRY_CREATE) {
        expect(roleCan('staff', p)).toBe(false);
      }
    }
  });

  it('an absent role grants nothing', () => {
    expect(roleCan(undefined, PERMISSIONS.ENTRY_CREATE)).toBe(false);
    expect(roleCan(null, PERMISSIONS.DATA_VIEW)).toBe(false);
  });
});
