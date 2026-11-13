import {apiRequest} from '@api/client';

/** A statement link sent to the retailer (only the server keeps its token's hash). */
export interface StatementLinkInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  periodFrom: string | null;
  status: 'live' | 'expired' | 'revoked';
  /** The latest time it was opened too often and limited (ST8), if ever. */
  limitedAt?: string | null;
}

/** Who a bulk send would reach now (ST7), and what would stop it. */
export interface BulkPreview {
  total: number;
  optedIn: number;
  notOptedIn: number;
  alreadyToday: number;
  noMobile: number;
  willSend: number;
  template: string | null;
  templateStatus: string;
  inWindow: boolean;
}

export interface BulkResult {
  sent: number;
  notOptedIn: number;
  alreadyToday: number;
  noMobile: number;
  failed: number;
  notTried: number;
  /** Why the batch stopped (over 10% failures), or null. */
  stopped: string | null;
}

export interface StatementSchedule {
  enabled: boolean;
  day: number;
  hour: number;
  beatId: string | null;
  lastRunMonth?: string | null;
  lastResult?: Partial<BulkResult> | null;
}

/** The retailer's choice about WhatsApp statements from this distributor. */
export type ConsentStatus = 'opted_in' | 'opted_out' | 'none';

export interface StatementEvent {
  kind: 'opt_in' | 'opt_out' | 'sent' | 'blocked' | 'link_created' | 'viewed' | 'delivered' | 'inbound' | 'shared'
    | 'link_revoked' | 'rate_limited';
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
  /** The retailer's statement language; null = the business default. */
  language?: string | null;
  defaultLanguage?: string;
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

  /** The language of this retailer's statement link, PDF and printed ledger (null = business default). */
  setLanguage: (customerId: string, language: string | null) =>
    apiRequest<{language: string | null; effective: string}>(`/customers/${customerId}/statement-language`, {
      method: 'PUT',
      body: {language},
    }),

  /** The business default for retailer statements (Telugu first). */
  businessLanguage: () => apiRequest<{language: string}>('/statement-language', {method: 'GET'}),
  setBusinessLanguage: (language: string) =>
    apiRequest<{language: string}>('/statement-language', {method: 'PUT', body: {language}}),

  setConsent: (customerId: string, status: 'opted_in' | 'opted_out', note?: string) =>
    apiRequest<StatementConsent>(`/customers/${customerId}/statement-consent`, {
      method: 'POST',
      body: {status, confirm: status === 'opted_in', note},
    }),

  /** A browser link to this retailer's statement only (no app needed). */
  /** `detailed`: the link's PDF prints each bill's lines (ST6). */
  link: (customerId: string, from?: string, detailed = false) =>
    apiRequest<{url: string; expiresInDays: number}>(`/customers/${customerId}/statement-link`, {
      method: 'POST',
      body: {from, detailed},
    }),

  /** Refused by the server (409) unless the retailer has opted in. */
  whatsapp: (customerId: string, from?: string, via: 'server' | 'phone' = 'phone', detailed = false) =>
    apiRequest<WhatsAppShare>(`/customers/${customerId}/statement-whatsapp`, {
      method: 'POST',
      body: {from, via, detailed},
    }),

  bulkPreview: (beatId?: string) =>
    apiRequest<BulkPreview>(`/statements/bulk/preview${beatId ? `?beatId=${beatId}` : ''}`, {method: 'GET'}),
  /** Owner: send now (the server keeps the caps and logs every outcome). */
  bulkSend: (beatId?: string) => apiRequest<BulkResult>('/statements/bulk', {method: 'POST', body: {beatId}}),
  schedule: () => apiRequest<StatementSchedule>('/statements/schedule', {method: 'GET'}),
  setSchedule: (s: StatementSchedule) =>
    apiRequest<StatementSchedule>('/statements/schedule', {
      method: 'PUT', body: {enabled: s.enabled, day: s.day, hour: s.hour, beatId: s.beatId},
    }),

  /** This retailer's statement links, newest first. */
  links: (customerId: string) =>
    apiRequest<StatementLinkInfo[]>(`/customers/${customerId}/statement-links`, {method: 'GET'}),

  /** Owner: close a link now (422 if it's already revoked — send a fresh one). */
  revokeLink: (linkId: string) =>
    apiRequest<StatementLinkInfo>(`/statements/${linkId}/revoke`, {method: 'POST'}),

  /** The check before any statement / ledger file is shared (sharePdf only):
   *  409 without consent for WhatsApp or the open share sheet; always logged.
   *  The printable ledger comes back as a short-lived `pdfUrl`. */
  pdfShare: (customerId: string, document: 'statement' | 'statement_csv' | 'ledger', channel: string,
    from?: string, to?: string, detailed = false) =>
    apiRequest<{status: 'ok'; channel: string; mobile: string | null; pdfUrl: string | null}>(
      `/customers/${customerId}/pdf-share`, {method: 'POST', body: {document, channel, from, to, detailed}}),
};
