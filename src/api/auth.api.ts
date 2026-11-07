import {apiRequest} from './client';
import type {
  CreateBusinessInput,
  RequestOtpInput,
  RequestOtpResponse,
  VerifyOtpInput,
  VerifyOtpResponse,
} from '@features/auth/types';
import type {Business} from '@features/auth/types';

// ---------------------------------------------------------------------------
// Auth API — talks to the FastAPI backend.
//
//   POST /api/v1/auth/otp/request  { mobile }            -> { verificationId, mobile }
//   POST /api/v1/auth/otp/verify   { verificationId, mobile, otp } -> { token, user }
//   POST /api/v1/businesses        CreateBusinessInput   -> Business   (Bearer token)
//
// In the backend's DEBUG mode the master OTP `123456` is always accepted, so
// you can log in without an SMS provider. The real per-request OTP is also
// printed to the backend log.
// ---------------------------------------------------------------------------

/** Dev hint shown on the OTP screen; matches the backend's debug master OTP. */
export const MOCK_OTP = '123456';

export function requestOtp(
  input: RequestOtpInput,
): Promise<RequestOtpResponse> {
  return apiRequest<RequestOtpResponse>('/auth/otp/request', {
    method: 'POST',
    body: input,
  });
}

export function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResponse> {
  return apiRequest<VerifyOtpResponse>('/auth/otp/verify', {
    method: 'POST',
    body: input,
  });
}

export function createBusiness(
  input: CreateBusinessInput,
): Promise<Business> {
  return apiRequest<Business>('/businesses', {
    method: 'POST',
    body: input,
  });
}

/**
 * Fetch the authenticated user's business.
 *
 *   GET /api/v1/businesses/me -> Business
 *
 * Used on launch to reconcile a returning user who has a token but no locally
 * cached business (new device / cleared storage) so they skip onboarding.
 * Rejects with a 400 ApiError when the user has not created a business yet.
 */
export function getMyBusiness(): Promise<Business> {
  return apiRequest<Business>('/businesses/me', {method: 'GET'});
}

export interface BusinessChoice {
  id: string;
  businessName: string;
  role: 'owner' | 'accountant' | 'staff';
}

/** Every business this user is assigned to (a CA may serve several owners). */
export function listMyBusinesses(): Promise<BusinessChoice[]> {
  return apiRequest<BusinessChoice[]>('/me/businesses', {method: 'GET'});
}

/** Open one of them: the server re-checks the membership for that business. */
export function openBusiness(id: string): Promise<Business> {
  return apiRequest<Business>('/businesses/me', {method: 'GET', headers: {'X-Business-Id': id}});
}
