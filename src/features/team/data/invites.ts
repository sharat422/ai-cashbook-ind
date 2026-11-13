import {openBusiness} from '@api/auth.api';
import {apiRequest} from '@api/client';
import type {Role} from '@features/auth/rbac';
import {useAuthStore} from '@store/auth.store';

/** The team invite log (AC2): phone and email invites, one membership either way. */
export interface TeamInviteEntry {
  id: string;
  channel: 'phone' | 'email';
  to: string | null;
  role: Role;
  name: string | null;
  sentBy: string;
  sentAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  status: 'pending' | 'expired' | 'replaced' | 'accepted';
}

export const invitesRemote = {
  list: () => apiRequest<TeamInviteEntry[]>('/team/invites', {method: 'GET'}),
  /** A signed link (7 days, one use) by email; the person joins from the app. */
  byEmail: (email: string, role: Role, name?: string) =>
    apiRequest<TeamInviteEntry>('/team/invites/email', {method: 'POST', body: {email, role, name}}),
  /** A new link; the old one stops working. */
  resend: (id: string) => apiRequest<TeamInviteEntry>(`/team/invites/${id}/resend`, {method: 'POST'}),
};

const TOKEN = /([0-9a-f]{32}\.\d+\.[0-9a-f]{32})/;

/** The invite token from a pasted link (https://…/invite/<token>, bolcash://invite/<token>) or the token itself. */
export function inviteToken(text: string | null | undefined): string | null {
  return TOKEN.exec(text ?? '')?.[1] ?? null;
}

/** Accept an email invite: the same membership as a phone invite, then open that business. */
export async function joinWithInvite(token: string): Promise<{businessName: string}> {
  const r = await apiRequest<{businessId: string; businessName: string; role: Role}>(
    '/team/invites/accept', {method: 'POST', body: {token}});
  useAuthStore.getState().setBusiness(await openBusiness(r.businessId));
  return r;
}
