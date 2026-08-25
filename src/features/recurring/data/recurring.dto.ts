import type {
  RecurringDraft,
  RecurringExpense,
  RecurringFrequency,
  RecurringList,
} from '@features/recurring/domain/entities';

export interface RecurringDto {
  id: string;
  name: string;
  amount: number;
  category: string;
  vendor: string;
  frequency: string;
  interval: number;
  anchor_day: number | null;
  next_due_date: string;
  last_posted_date: string | null;
  notes: string | null;
  active: boolean;
  is_due: boolean;
  created_at: string;
}

export interface RecurringListDto {
  items: RecurringDto[];
  due_count: number;
  due_total: number;
  monthly_total: number;
}

export interface PostOccurrenceDto {
  recurring: RecurringDto;
  expense: {id: string; amount: number; date: string; category: string};
}

export function toRecurring(dto: RecurringDto): RecurringExpense {
  return {
    id: dto.id,
    name: dto.name,
    amount: Number(dto.amount ?? 0),
    category: dto.category,
    vendor: dto.vendor ?? '',
    frequency: (dto.frequency as RecurringFrequency) ?? 'monthly',
    interval: Number(dto.interval ?? 1),
    anchorDay: dto.anchor_day ?? null,
    nextDueDate: dto.next_due_date,
    lastPostedDate: dto.last_posted_date ?? null,
    notes: dto.notes ?? undefined,
    active: !!dto.active,
    isDue: !!dto.is_due,
    createdAt: dto.created_at,
  };
}

export function toRecurringList(dto: RecurringListDto): RecurringList {
  return {
    items: (dto.items ?? []).map(toRecurring),
    dueCount: Number(dto.due_count ?? 0),
    dueTotal: Number(dto.due_total ?? 0),
    monthlyTotal: Number(dto.monthly_total ?? 0),
  };
}

export function fromRecurringDraft(draft: RecurringDraft): Record<string, unknown> {
  return {
    name: draft.name,
    amount: draft.amount,
    category: draft.category,
    vendor: draft.vendor,
    frequency: draft.frequency,
    interval: draft.interval,
    next_due_date: draft.nextDueDate,
    notes: draft.notes ?? null,
    active: draft.active,
  };
}
