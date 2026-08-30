import {apiRequest} from '@api/client';
import type {Role} from '@features/auth/rbac';

export interface TeamMember {
  userId: string;
  mobile: string;
  role: Role;
  status: string;
  isSelf: boolean;
  createdAt: string;
}

interface TeamMemberDto {
  user_id: string;
  mobile: string | null;
  role: Role;
  status: string;
  is_self: boolean;
  created_at: string;
}

function toMember(d: TeamMemberDto): TeamMember {
  return {
    userId: d.user_id,
    mobile: d.mobile ?? '',
    role: d.role,
    status: d.status,
    isSelf: !!d.is_self,
    createdAt: d.created_at,
  };
}

/** Team management — owner-only endpoints (server-enforced). */
export const teamRemote = {
  async list(): Promise<TeamMember[]> {
    const dtos = await apiRequest<TeamMemberDto[]>('/team', {method: 'GET'});
    return dtos.map(toMember);
  },
  async add(mobile: string, role: Role): Promise<TeamMember> {
    return toMember(
      await apiRequest<TeamMemberDto>('/team', {method: 'POST', body: {mobile, role}}),
    );
  },
  async updateRole(userId: string, role: Role): Promise<TeamMember> {
    return toMember(
      await apiRequest<TeamMemberDto>(`/team/${userId}`, {method: 'PATCH', body: {role}}),
    );
  },
  async remove(userId: string): Promise<void> {
    await apiRequest<null>(`/team/${userId}`, {method: 'DELETE'});
  },
};
