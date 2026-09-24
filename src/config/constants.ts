/**
 * App-wide configuration constants.
 * Values here are safe to read from any layer of the app.
 */

export const APP_CONFIG = {
  name: 'Smart CashBook',
  /** User-facing app version (keep in step with the iOS/Android build number). */
  version: '1.0.0',
  /** How long the splash screen stays visible while bootstrapping (ms). */
  splashDurationMs: 1500,
  /** OTP length expected from the backend. */
  otpLength: 6,
  /** Resend OTP cooldown window (seconds). */
  otpResendSeconds: 30,
} as const;
// Note: the live API base URL comes from ENV.apiBaseUrl (src/config/env.ts),
// baked per-environment at build time by Codemagic — never hard-coded here.

/**
 * Customer-support channels. Set these to your real support number/email before
 * release — the Help screen deep-links WhatsApp and email to them, and the bug
 * report falls back to them if the in-app submit fails.
 */
export const SUPPORT = {
  /** WhatsApp support number in international format, no +/spaces (e.g. 9198…). */
  whatsapp: '919000000000',
  email: 'support@smartcashbook.example.com',
} as const;

/**
 * Privacy / grievance contact — the person handling data-protection questions
 * and grievances under India's DPDP Act. This is DELIBERATELY separate from
 * generic customer support (SUPPORT above). Set these to a real named person +
 * dedicated address before launch, and keep them IDENTICAL to what your Privacy
 * Policy and Terms state.
 */
export const GRIEVANCE = {
  /** Named grievance / data-protection officer (a person or role title). */
  officerName: 'Grievance Officer',
  /** Dedicated privacy/grievance mailbox (NOT the general support email). */
  email: 'privacy@smartcashbook.example.com',
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
