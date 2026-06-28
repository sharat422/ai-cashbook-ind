import {useMutation} from '@tanstack/react-query';

import {verifyOtp} from '@api/auth.api';
import type {VerifyOtpInput, VerifyOtpResponse} from '@features/auth/types';
import {useAuthStore} from '@store/auth.store';

/**
 * Verifies the OTP and, on success, writes the session into the auth store.
 * The store transition (token set, no business yet) moves the user to the
 * "pending-business" stack automatically.
 */
export function useVerifyOtp() {
  const setSession = useAuthStore(state => state.setSession);

  return useMutation<VerifyOtpResponse, Error, VerifyOtpInput>({
    mutationFn: verifyOtp,
    onSuccess: ({token, user}) => {
      setSession({token, user});
    },
  });
}
