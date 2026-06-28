import type {Expense, ExpenseCategory} from '@features/expense/domain/entities';

/** Shape returned by the FastAPI backend (snake_case). */
export interface ExpenseDto {
  id: string;
  amount: number;
  category: string;
  date: string;
  vendor: string;
  notes: string | null;
  attachment_url: string | null;
  created_at: string;
}

/** Map a backend DTO to a domain entity. */
export function toExpense(dto: ExpenseDto): Expense {
  return {
    id: dto.id,
    amount: dto.amount,
    category: dto.category as ExpenseCategory,
    date: dto.date,
    vendor: dto.vendor,
    notes: dto.notes ?? undefined,
    attachmentUrl: dto.attachment_url ?? undefined,
    attachment: null,
    createdAt: dto.created_at,
    syncStatus: 'synced',
  };
}
