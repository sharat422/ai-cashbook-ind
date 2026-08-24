import {customerRemote} from '@features/customers/data/customer.remote';
import type {Customer} from '@features/customers/domain/entities';
import {ledgerRemote} from '@features/customers/data/ledger.remote';
import type {PaymentMethod} from '@features/customers/domain/ledger';
import type {ParsedType} from './entities';

function makeClientId(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Customers whose name matches — powers the "Which Ramesh?" disambiguation. */
export async function findCustomerCandidates(name: string): Promise<Customer[]> {
  const q = name.trim();
  if (!q) return [];
  const page = await customerRemote.list({search: q, cursor: null, limit: 10});
  return page.items;
}

/** Exact (case-insensitive) full-name match among candidates, if unique. */
export function exactMatch(name: string, candidates: Customer[]): Customer | null {
  const n = name.trim().toLowerCase();
  const hits = candidates.filter(c => c.fullName.trim().toLowerCase() === n);
  return hits.length === 1 ? hits[0] : null;
}

export function createCustomerByName(name: string): Promise<Customer> {
  return customerRemote.create({fullName: name.trim(), mobile: ''});
}

export interface LedgerInput {
  type: ParsedType;
  amount: number;
  date: string;
  /** Only used for payment entries. */
  paymentMethod?: PaymentMethod;
  notes?: string;
}

/** Add the credit/payment ledger entry to an already-resolved customer. */
export async function addLedgerForCustomer(
  customerId: string,
  input: LedgerInput,
): Promise<void> {
  await ledgerRemote.add(
    customerId,
    {
      type: input.type,
      amount: input.amount,
      date: input.date,
      paymentMethod: input.type === 'payment' ? input.paymentMethod : undefined,
      notes: input.notes,
    },
    makeClientId(),
  );
}
