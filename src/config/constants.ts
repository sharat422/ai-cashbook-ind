/**
 * App-wide configuration constants.
 * Values here are safe to read from any layer of the app.
 */

export const APP_CONFIG = {
  name: 'Smart CashBook',
  /**
   * TEMPORARY: skip phone/OTP login and open the app straight to the
   * landing (Dashboard) screen. Set back to `false` to re-enable auth.
   */
  bypassAuth: true,
  /** Base URL for the backend API. Swap with env-driven config in production. */
  apiBaseUrl: 'https://api.smartcashbook.example.com',
  /** How long the splash screen stays visible while bootstrapping (ms). */
  splashDurationMs: 1500,
  /** OTP length expected from the backend. */
  otpLength: 6,
  /** Resend OTP cooldown window (seconds). */
  otpResendSeconds: 30,
} as const;

/** Business types selectable on the Create Business screen. */
export const BUSINESS_TYPES = [
  'Retail',
  'Wholesale',
  'Manufacturing',
  'Services',
  'Restaurant / Food',
  'E-commerce',
  'Other',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Indian states & union territories for the State picker. */
export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];
