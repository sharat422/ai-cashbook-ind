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

export interface Beat {
  id: string;
  name: string;
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  assignedUserId: string | null;
  retailers: BeatRetailer[];
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
