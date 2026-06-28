import type {
  Customer,
  CustomerDraft,
  CustomerPage,
} from '@features/customers/domain/entities';

/** Backend customer shape (snake_case). */
export interface CustomerDto {
  id: string;
  full_name: string;
  mobile: string;
  gst_number: string | null;
  business_name: string | null;
  address: string | null;
  notes: string | null;
  outstanding_amount: number;
  last_transaction_date: string | null;
  is_overdue: boolean;
  created_at: string;
}

export interface CustomerPageDto {
  items: CustomerDto[];
  next_cursor: string | null;
  total: number;
}

export function toCustomer(dto: CustomerDto): Customer {
  return {
    id: dto.id,
    fullName: dto.full_name,
    mobile: dto.mobile,
    gstNumber: dto.gst_number ?? undefined,
    businessName: dto.business_name ?? undefined,
    address: dto.address ?? undefined,
    notes: dto.notes ?? undefined,
    outstandingAmount: Number(dto.outstanding_amount ?? 0),
    lastTransactionDate: dto.last_transaction_date ?? null,
    isOverdue: Boolean(dto.is_overdue),
    createdAt: dto.created_at,
  };
}

export function toCustomerPage(dto: CustomerPageDto): CustomerPage {
  return {
    items: (dto.items ?? []).map(toCustomer),
    nextCursor: dto.next_cursor ?? null,
    total: Number(dto.total ?? 0),
  };
}

/** Map a draft to the backend request body. */
export function fromCustomerDraft(draft: CustomerDraft): Record<string, unknown> {
  return {
    full_name: draft.fullName,
    mobile: draft.mobile,
    gst_number: draft.gstNumber ?? null,
    business_name: draft.businessName ?? null,
    address: draft.address ?? null,
    notes: draft.notes ?? null,
  };
}
