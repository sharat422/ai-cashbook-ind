import {apiRequest} from '@api/client';
import {downloadAndShare} from '@api/download';

/** The retailer's choice about WhatsApp statements from this distributor. */
export type ConsentStatus = 'opted_in' | 'opted_out' | 'none';

export interface StatementEvent {
  kind: 'opt_in' | 'opt_out' | 'sent' | 'blocked' | 'link_created' | 'viewed';
  source: 'owner' | 'retailer' | 'system';
  channel: string | null;
  note: string | null;
  createdAt: string;
}

export interface StatementConsent {
  status: ConsentStatus;
  since: string | null;
  source: 'owner' | 'retailer' | null;
  history: StatementEvent[];
}

export interface WhatsAppShare {
  status: 'sent' | 'ready';
  url: string;
  message: string;
  mobile: string;
}

export const statementsRemote = {
  consent: (customerId: string) =>
    apiRequest<StatementConsent>(`/customers/${customerId}/statement-consent`, {method: 'GET'}),

  setConsent: (customerId: string, status: 'opted_in' | 'opted_out', note?: string) =>
    apiRequest<StatementConsent>(`/customers/${customerId}/statement-consent`, {
      method: 'POST',
      body: {status, confirm: status === 'opted_in', note},
    }),

  /** A browser link to this retailer's statement only (no app needed). */
  link: (customerId: string, from?: string) =>
    apiRequest<{url: string; expiresInDays: number}>(`/customers/${customerId}/statement-link`, {
      method: 'POST',
      body: {from},
    }),

  /** Refused by the server (409) unless the retailer has opted in. */
  whatsapp: (customerId: string, from?: string, via: 'server' | 'phone' = 'phone') =>
    apiRequest<WhatsAppShare>(`/customers/${customerId}/statement-whatsapp`, {
      method: 'POST',
      body: {from, via},
    }),

  /** Print-friendly ledger PDF with page totals, from the server. */
  printLedger: (customerId: string, from: string, to: string) =>
    downloadAndShare(
      `/customers/${customerId}/ledger.pdf?from=${from}&to=${to}`,
      `Ledger_${from}_${to}.pdf`,
      'application/pdf',
    ),
};
