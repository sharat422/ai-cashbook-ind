import {useMutation} from '@tanstack/react-query';

import {createBusiness} from '@api/auth.api';
import type {Business, CreateBusinessInput} from '@features/auth/types';
import {useAuthStore} from '@store/auth.store';

/**
 * Creates the user's business and stores it. Once a business exists the auth
 * store reports "authenticated", switching the user to the app (Dashboard).
 */
export function useCreateBusiness() {
  const setBusiness = useAuthStore(state => state.setBusiness);

  return useMutation<Business, Error, CreateBusinessInput>({
    mutationFn: createBusiness,
    onSuccess: business => {
      setBusiness(business);
    },
  });
}
