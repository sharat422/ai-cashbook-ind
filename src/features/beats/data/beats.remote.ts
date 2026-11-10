import {apiRequest} from '@api/client';

/**
 * Beat plan API. The SERVER decides which beats a caller may see: staff only
 * ever receive their own beats, and any other beat id answers 403. Nothing here
 * filters beats on the client — that would not be a security control.
 *
 *   GET  /api/v1/beats                          -> BeatDto[] (with retailers)
 *   GET  /api/v1/beats/today                    -> BeatDto[] scheduled today (IST)
 *   GET  /api/v1/beats/{id}                     -> BeatDto
 *   POST /api/v1/beats                          -> BeatDto (owner)
 *   PUT  /api/v1/beats/{id}/retailers/order     -> BeatDto (owner)
 *   GET  /api/v1/beats?deleted=true             -> deleted BeatDto[] (owner)
 *   PUT  /api/v1/beats/{id}/restore             -> BeatDto (owner; a live beat: no-op)
 *   POST /api/v1/visits                         -> VisitDto (idempotent on clientId)
 */

export type VisitOutcome = 'visited_ordered' | 'visited_no_order' | 'not_visited';

export interface Visit {
  id: string;
  clientId: string;
  beatId: string;
  customerId: string;
  outcome: VisitOutcome;
  reason: string | null;
  promiseDate: string | null;
  visitedAt: string;
}

export interface BeatRetailer {
  customerId: string;
  fullName: string;
  businessName: string | null;
  visitOrder: number;
  outstandingAmount: number;
  overdueAmount: number;
  creditLimit: number | null;
  lastPromiseDate: string | null;
  todayVisit: Visit | null;
}

/** A staff member on a beat today or from a later date; exactly one is the primary. */
export interface BeatAssignment {
  userId: string;
  role: 'primary' | 'secondary';
  name: string | null;
  mobile: string | null;
  /** First and last day (YYYY-MM-DD); validTo null = open-ended. */
  validFrom: string;
  validTo: string | null;
}

export interface Beat {
  id: string;
  name: string;
  assignments: BeatAssignment[];
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  assignedUserId: string | null;
  retailers: BeatRetailer[];
}

/** A past visit, with names, for the visit history screen. */
export interface VisitRecord extends Visit {
  customerName: string;
  beatName: string;
  userId: string | null;
  userMobile: string | null;
  userName: string | null;
}

export interface VisitQuery {
  customerId?: string;
  userId?: string;
  beatId?: string;
  from?: string;
  to?: string;
}

export interface BeatDraft {
  name: string;
  weekdays: number[];
  assignedUserId: string | null;
  customerIds: string[];
}

export interface VisitInput {
  clientId: string;
  beatId: string;
  customerId: string;
  outcome: VisitOutcome;
  reason?: string;
  promiseDate?: string;
  /** When it happened (ISO). Sent so an offline visit keeps its real time. */
  visitedAt: string;
}

interface VisitDto {
  id: string;
  client_id: string;
  beat_id: string;
  customer_id: string;
  outcome: VisitOutcome;
  reason: string | null;
  promise_date: string | null;
  visited_at: string;
}

interface BeatDto {
  id: string;
  name: string;
  weekdays: number[];
  assigned_user_id: string | null;
  assignments?: Array<{
    user_id: string; role: 'primary' | 'secondary'; name: string | null; mobile: string | null;
    valid_from: string; valid_to: string | null;
  }>;
  retailers: Array<{
    customer_id: string;
    full_name: string;
    business_name: string | null;
    visit_order: number;
    outstanding_amount: number;
    overdue_amount: number;
    credit_limit: number | null;
    last_promise_date: string | null;
    today_visit: VisitDto | null;
  }>;
}

const toVisit = (d: VisitDto): Visit => ({
  id: d.id,
  clientId: d.client_id,
  beatId: d.beat_id,
  customerId: d.customer_id,
  outcome: d.outcome,
  reason: d.reason,
  promiseDate: d.promise_date,
  visitedAt: d.visited_at,
});

const toBeat = (d: BeatDto): Beat => ({
  id: d.id,
  assignments: (d.assignments ?? []).map(a => ({
    userId: a.user_id, role: a.role, name: a.name, mobile: a.mobile, validFrom: a.valid_from, validTo: a.valid_to,
  })),
  name: d.name,
  weekdays: d.weekdays,
  assignedUserId: d.assigned_user_id,
  retailers: d.retailers.map(r => ({
    customerId: r.customer_id,
    fullName: r.full_name,
    businessName: r.business_name,
    visitOrder: r.visit_order,
    outstandingAmount: Number(r.outstanding_amount ?? 0),
    overdueAmount: Number(r.overdue_amount ?? 0),
    creditLimit: r.credit_limit,
    lastPromiseDate: r.last_promise_date,
    todayVisit: r.today_visit ? toVisit(r.today_visit) : null,
  })),
});

export const beatsRemote = {
  async list(): Promise<Beat[]> {
    return (await apiRequest<BeatDto[]>('/beats', {method: 'GET'})).map(toBeat);
  },
  async today(): Promise<Beat[]> {
    return (await apiRequest<BeatDto[]>('/beats/today', {method: 'GET'})).map(toBeat);
  },
  async get(id: string): Promise<Beat> {
    return toBeat(await apiRequest<BeatDto>(`/beats/${id}`, {method: 'GET'}));
  },
  async create(draft: BeatDraft): Promise<Beat> {
    return toBeat(await apiRequest<BeatDto>('/beats', {method: 'POST', body: draft}));
  },
  async edit(beatId: string, draft: Omit<BeatDraft, 'customerIds'>): Promise<Beat> {
    return toBeat(await apiRequest<BeatDto>(`/beats/${beatId}`, {method: 'PUT', body: draft}));
  },
  /** Add a helper (secondary) from validFrom (default today) to an optional last day. Owner only. */
  async addHelper(beatId: string, userId: string, validFrom?: string, validTo?: string | null): Promise<Beat> {
    return toBeat(await apiRequest<BeatDto>(`/beats/${beatId}/helpers`, {
      method: 'POST', body: {userId, validFrom, validTo: validTo || undefined},
    }));
  },
  /** A helper's last day on the beat is today; their visits stay in history. */
  async removeHelper(beatId: string, userId: string): Promise<Beat> {
    return toBeat(await apiRequest<BeatDto>(`/beats/${beatId}/helpers/${userId}`, {method: 'DELETE'}));
  },
  async listDeleted(): Promise<Beat[]> {
    return (await apiRequest<BeatDto[]>('/beats?deleted=true', {method: 'GET'})).map(toBeat);
  },
  /** Undo a delete: same shops in the same order; visits and closes never left. */
  async restore(beatId: string): Promise<Beat> {
    return toBeat(await apiRequest<BeatDto>(`/beats/${beatId}/restore`, {method: 'PUT'}));
  },
  /** Soft delete: the beat leaves every list; its visits stay in the history. */
  async remove(beatId: string): Promise<void> {
    await apiRequest<null>(`/beats/${beatId}`, {method: 'DELETE'});
  },
  async history(q: VisitQuery): Promise<VisitRecord[]> {
    const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    const rows = await apiRequest<(VisitDto & {customer_name: string; beat_name: string; user_id: string | null;
      user_mobile: string | null; user_name: string | null})[]>(`/visits${qs ? `?${qs}` : ''}`, {method: 'GET'});
    return rows.map(r => ({...toVisit(r), customerName: r.customer_name, beatName: r.beat_name,
      userId: r.user_id, userMobile: r.user_mobile, userName: r.user_name}));
  },
  async setRetailers(beatId: string, customerIds: string[]): Promise<Beat> {
    return toBeat(
      await apiRequest<BeatDto>(`/beats/${beatId}/retailers/order`, {
        method: 'PUT',
        body: {customerIds},
      }),
    );
  },
  async recordVisit(input: VisitInput): Promise<Visit> {
    return toVisit(await apiRequest<VisitDto>('/visits', {method: 'POST', body: input}));
  },
};
