import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import type {Role} from '@features/auth/rbac';
import {teamRemote} from '@features/team/data/team.remote';

export function useTeam() {
  return useQuery({queryKey: ['team'], queryFn: teamRemote.list});
}

export function useTeamMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({queryKey: ['team']});

  const add = useMutation({
    mutationFn: ({mobile, role}: {mobile: string; role: Role}) =>
      teamRemote.add(mobile, role),
    onSuccess: invalidate,
  });
  const updateRole = useMutation({
    mutationFn: ({userId, role}: {userId: string; role: Role}) =>
      teamRemote.updateRole(userId, role),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => teamRemote.remove(userId),
    onSuccess: invalidate,
  });

  return {add, updateRole, remove};
}
