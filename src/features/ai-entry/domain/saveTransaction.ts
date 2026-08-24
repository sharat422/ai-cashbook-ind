import {customerRemote} from '@features/customers/data/customer.remote';
import type {Customer} from '@features/customers/domain/entities';
import {ledgerRemote} from '@features/customers/data/ledger.remote';
import type {ParsedType} from './entities';

function makeClientId(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface ConfirmedTransaction {
  customerName: string;
  type: ParsedType;
  amount: number;
  date: string;
  notes?: string;
}

/**
 * Persist a confirmed voice/AI transaction: find the customer by name
 * (case-insensitive) or create them, then add the credit/payment ledger entry.
 * Returns the resolved customer.
 */
export async function saveParsedTransaction(
  input: ConfirmedTransaction,
): Promise<Customer> {
  const name = input.customerName.trim();

  const page = await customerRemote.list({search: name, cursor: null, limit: 5});
  const match = page.items.find(
    c => c.fullName.trim().toLowerCase() === name.toLowerCase(),
  );
  const customer = match ?? (await customerRemote.create({fullName: name, mobile: ''}));

  await ledgerRemote.add(
    customer.id,
    {
      type: input.type,
      amount: input.amount,
      date: input.date,
      notes: input.notes,
    },
    makeClientId(),
  );

  return customer;
}
