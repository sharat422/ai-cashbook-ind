/**
 * Client-side mirror of the backend RBAC map (backend/app/rbac.py).
 *
 * This ONLY gates the UI (hide what the server would reject). The server is the
 * real boundary — never rely on this for security, only for UX.
 */

export type Role = 'owner' | 'accountant' | 'staff';

export const PERMISSIONS = {
  ENTRY_CREATE: 'entry.create',
  ENTRY_EDIT: 'entry.edit',
  ENTRY_DELETE: 'entry.delete',
  DATA_VIEW: 'data.view',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  SETTINGS_MANAGE: 'settings.manage',
  TEAM_MANAGE: 'team.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL: Permission[] = Object.values(PERMISSIONS);

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ALL),
  accountant: new Set<Permission>([
    PERMISSIONS.ENTRY_CREATE,
    PERMISSIONS.ENTRY_EDIT,
    PERMISSIONS.DATA_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
  ]),
  // Pure add-only: no lists, reports, settings, edit or delete.
  staff: new Set<Permission>([PERMISSIONS.ENTRY_CREATE]),
};

/** Whether a role grants a permission. Unknown/absent role → no access. */
export function roleCan(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  accountant: 'Accountant',
  staff: 'Staff',
};
