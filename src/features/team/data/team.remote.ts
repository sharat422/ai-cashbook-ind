import {apiRequest} from '@api/client';
import type {Role} from '@features/auth/rbac';

export interface TeamMember {
  userId: string;
  /** The owner's name for this person (null = show the mobile number). */
  name: string | null;
  mobile: string;
  role: Role;
  status: string;
  isSelf: boolean;
  createdAt: string;
}

interface TeamMemberDto {
  user_id: string;
  name?: string | null;
  mobile: string | null;
  role: Role;
  status: string;
  is_self: boolean;
  created_at: string;
}

function toMember(d: TeamMemberDto): TeamMember {
  return {
    userId: d.user_id,
    name: d.name ?? null,
    mobile: d.mobile ?? '',
    role: d.role,
    status: d.status,
    isSelf: !!d.is_self,
    createdAt: d.created_at,
  };
}

/** One accountant API call, as the owner's audit log shows it. */
export interface AccessEntry {
  at: string;
  atIst: string;
  mobile: string;
  name: string | null;
  userId: string | null;
  action: 'view' | 'export' | 'denied';
  area: 'ledger' | 'ageing' | 'customers' | 'dailyClose' | 'gst' | 'reports' | 'dashboard' | 'export' | 'assistant' | 'other';
  customer: string | null;
  path: string;
  /** AC7, Ask AI: "Asked: … Used: …" (the figures the answer cited, never its text). */
  detail?: string | null;
}

/** AC4: an accountant's export the owner hasn't opened yet (a notice on the home screen). */
export interface ExportAlert {
  id: string;
  at: string;
  name: string | null;
  mobile: string;
  what: 'tally' | 'gstr1' | 'gstr3b' | 'itc' | 'data' | 'balances' | 'statement' | 'report' | 'other';
}

/** `from`/`to`: IST days (AC4), both included; none = the latest 300. */
export const activityQuery = (userId?: string, from?: string, to?: string): string => {
  const q = [userId ? `user_id=${encodeURIComponent(userId)}` : '', from ? `from=${from}` : '', to ? `to=${to}` : '']
    .filter(Boolean).join('&');
  return q ? `?${q}` : '';
};

/** Team management — owner-only endpoints (server-enforced). */
export const teamRemote = {
  async list(): Promise<TeamMember[]> {
    const dtos = await apiRequest<TeamMemberDto[]>('/team', {method: 'GET'});
    return dtos.map(toMember);
  },
  async add(mobile: string, role: Role, name?: string): Promise<TeamMember> {
    return toMember(
      await apiRequest<TeamMemberDto>('/team', {method: 'POST', body: {mobile, role, name}}),
    );
  },
  async rename(userId: string, name: string): Promise<TeamMember> {
    return toMember(await apiRequest<TeamMemberDto>(`/team/${userId}`, {method: 'PATCH', body: {name}}));
  },
  async updateRole(userId: string, role: Role): Promise<TeamMember> {
    return toMember(
      await apiRequest<TeamMemberDto>(`/team/${userId}`, {method: 'PATCH', body: {role}}),
    );
  },
  /** Revoke: takes effect on the member's very next request. */
  async remove(userId: string): Promise<void> {
    await apiRequest<null>(`/team/${userId}`, {method: 'DELETE'});
  },
  activity: (userId?: string, from?: string, to?: string) =>
    apiRequest<AccessEntry[]>(`/team/activity${activityQuery(userId, from, to)}`, {method: 'GET'}),
  exportAlerts: () => apiRequest<ExportAlert[]>('/team/export-alerts', {method: 'GET'}),
  exportAlertsSeen: () => apiRequest<{cleared: number}>('/team/export-alerts/seen', {method: 'POST'}),
};
