import {apiRequest} from '@api/client';
import type {Business} from '@features/auth/types';

/** Fields the owner can correct on their own business/account. */
export interface BusinessUpdate {
  businessName?: string;
  ownerName?: string;
  businessType?: string;
  state?: string;
  gstRegistered?: boolean;
}

export interface DeleteResult {
  deleted: boolean;
  counts: Record<string, number>;
}

/**
 * Self-service data rights (DPDP):
 *   GET    /account/export   — full data export (JSON)
 *   PATCH  /businesses/me    — correct business/account info
 *   DELETE /account          — erase the account (typed confirmation required)
 */
export const accountRemote = {
  exportData: () =>
    apiRequest<Record<string, unknown>>('/account/export', {method: 'GET'}),

  updateBusiness: (patch: BusinessUpdate) =>
    apiRequest<Business>('/businesses/me', {method: 'PATCH', body: patch}),

  deleteAccount: (confirmation: string) =>
    apiRequest<DeleteResult>('/account', {
      method: 'DELETE',
      body: {confirmation},
    }),
};

/** The exact phrase the user must type to confirm deletion (matches backend). */
export const DELETE_CONFIRMATION = 'DELETE MY ACCOUNT';
