import type {Income, IncomeCategory} from '@features/income/domain/entities';

/** Shape returned by the FastAPI backend (snake_case). */
export interface IncomeDto {
  id: string;
  amount: number;
  category: string;
  date: string;
  notes: string | null;
  attachment_url: string | null;
  created_at: string;
}

/** Map a backend DTO to a domain entity. */
export function toIncome(dto: IncomeDto): Income {
  return {
    id: dto.id,
    amount: dto.amount,
    category: dto.category as IncomeCategory,
    date: dto.date,
    notes: dto.notes ?? undefined,
    attachmentUrl: dto.attachment_url ?? undefined,
    attachment: null,
    createdAt: dto.created_at,
    syncStatus: 'synced',
  };
}
