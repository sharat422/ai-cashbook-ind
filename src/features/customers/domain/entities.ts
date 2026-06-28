/**
 * Domain entities for the Customer Management module. Pure types — no framework
 * imports.
 */

/** A saved customer with derived ledger fields from the backend. */
export interface Customer {
  id: string;
  fullName: string;
  mobile: string;
  gstNumber?: string;
  businessName?: string;
  address?: string;
  notes?: string;
  /** Outstanding receivable in whole INR (0 = settled). */
  outstandingAmount: number;
  /** ISO date of the most recent transaction, or null if none. */
  lastTransactionDate?: string | null;
  /** Whether any outstanding amount is past its due date. */
  isOverdue: boolean;
  createdAt: string;
}

/** The editable fields collected on the add/edit form. */
export interface CustomerDraft {
  fullName: string;
  mobile: string;
  gstNumber?: string;
  businessName?: string;
  address?: string;
  notes?: string;
}

/** Dues status — drives the colour indicators. */
export type CustomerStatus = 'no-dues' | 'pending' | 'overdue';

/** Derive the dues status from the customer's ledger fields. */
export function customerStatus(customer: Customer): CustomerStatus {
  if (customer.outstandingAmount <= 0) return 'no-dues';
  return customer.isOverdue ? 'overdue' : 'pending';
}

// ---- Pagination / search ----

export interface CustomerQuery {
  search: string;
  cursor: string | null;
  limit: number;
}

export interface CustomerPage {
  items: Customer[];
  nextCursor: string | null;
  total: number;
}
