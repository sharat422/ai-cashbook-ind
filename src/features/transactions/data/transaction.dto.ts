import type {
  Transaction,
  TransactionPage,
  TransactionType,
} from '@features/transactions/domain/entities';

/** Single transaction as returned by the backend (snake_case). */
export interface TransactionDto {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  vendor: string | null;
  notes: string | null;
  created_at: string;
}

/** Paginated envelope returned by the backend. */
export interface TransactionPageDto {
  items: TransactionDto[];
  next_cursor: string | null;
  total: number;
}

export function toTransaction(dto: TransactionDto): Transaction {
  return {
    id: dto.id,
    type: dto.type,
    amount: Number(dto.amount ?? 0),
    category: dto.category,
    date: dto.date,
    vendor: dto.vendor ?? undefined,
    notes: dto.notes ?? undefined,
    createdAt: dto.created_at,
  };
}

export function toTransactionPage(dto: TransactionPageDto): TransactionPage {
  return {
    items: (dto.items ?? []).map(toTransaction),
    nextCursor: dto.next_cursor ?? null,
    total: Number(dto.total ?? 0),
  };
}
