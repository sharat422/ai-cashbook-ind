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
    mutationFn: ({mobile, role, name}: {mobile: string; role: Role; name?: string}) =>
      teamRemote.add(mobile, role, name),
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

  const rename = useMutation({
    mutationFn: ({userId, name}: {userId: string; name: string}) => teamRemote.rename(userId, name),
    onSuccess: invalidate,
  });
  return {add, updateRole, remove, rename};
}
