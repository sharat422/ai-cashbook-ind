import type {BusinessType, IndianState} from '@config/constants';
import type {Role} from '@features/auth/rbac';

/** Authenticated user identity returned by the backend. */
export interface User {
  id: string;
  mobile: string;
}

/** A business profile the authenticated user belongs to. */
export interface Business {
  id: string;
  businessName: string;
  ownerName: string;
  businessType: BusinessType;
  state: IndianState;
  gstRegistered: boolean;
  /** The caller's role in this business (from /businesses/me). Absent for the
   *  local create response; defaults to owner (the creator). */
  role?: Role;
}

/** Payload sent when creating a business. */
export type CreateBusinessInput = Omit<Business, 'id'>;

/** Request OTP for a mobile number. */
export interface RequestOtpInput {
  mobile: string;
}

export interface RequestOtpResponse {
  /** Opaque token tying a verification attempt to the requested mobile. */
  verificationId: string;
  /** Echoed back so the UI can confirm which number is being verified. */
  mobile: string;
}

/** Verify the OTP the user entered. */
export interface VerifyOtpInput {
  verificationId: string;
  mobile: string;
  otp: string;
}

export interface VerifyOtpResponse {
  token: string;
  user: User;
}
