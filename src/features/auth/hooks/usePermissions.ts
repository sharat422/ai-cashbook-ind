import {useCallback} from 'react';

import {roleCan, type Permission, type Role} from '@features/auth/rbac';
import {useAuthStore} from '@store/auth.store';

/**
 * The caller's role in the active business + a `can(permission)` gate.
 *
 * A missing role means the creator's own freshly-made business (the create
 * response carries no role) — they're the owner, so we default to full access.
 * Members always receive their real role from /businesses/me. The server
 * enforces regardless; this only decides what UI to show.
 */
export function usePermissions(): {role: Role; can: (p: Permission) => boolean} {
  const role = (useAuthStore(s => s.business?.role) ?? 'owner') as Role;
  const can = useCallback((permission: Permission) => roleCan(role, permission), [role]);
  return {role, can};
}
