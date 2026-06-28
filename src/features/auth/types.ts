import type {BusinessType, IndianState} from '@config/constants';

/** Authenticated user identity returned by the backend. */
export interface User {
  id: string;
  mobile: string;
}

/** A business profile owned by the authenticated user. */
export interface Business {
  id: string;
  businessName: string;
  ownerName: string;
  businessType: BusinessType;
  state: IndianState;
  gstRegistered: boolean;
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
