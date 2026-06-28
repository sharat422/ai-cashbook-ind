import {useMutation} from '@tanstack/react-query';

import {requestOtp} from '@api/auth.api';
import type {RequestOtpInput, RequestOtpResponse} from '@features/auth/types';

/** Requests an OTP for the supplied mobile number. */
export function useRequestOtp() {
  return useMutation<RequestOtpResponse, Error, RequestOtpInput>({
    mutationFn: requestOtp,
  });
}
