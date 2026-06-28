import type {CustomerLedger, LedgerEntry, LedgerEntryDraft} from './ledger';

/** Repository contract for a customer's ledger. */
export interface LedgerRepository {
  /** Fetch entries and return them with running balances + totals. */
  getLedger(customerId: string): Promise<CustomerLedger>;
  /** Append a credit or payment entry. */
  addEntry(customerId: string, draft: LedgerEntryDraft): Promise<LedgerEntry>;
}
