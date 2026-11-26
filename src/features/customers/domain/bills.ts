/**
 * Bills (credit sales) and the payments made against them. The server works
 * out what each bill has been paid (GET /customers/{id}/bills): payments linked
 * to a bill pay it; payments with no link pay the oldest bills. The bills'
 * `left` adds up to the customer's balance.
 */
export interface Bill {
  /** The credit entry's id: the bill's identity. */
  id: string;
  date: string;
  number?: string;
  amount: number;
  paid: number;
  left: number;
  /** 'paid' only when nothing is left. */
  status: 'paid' | 'part' | 'open';
}

export interface CustomerBills {
  /** Oldest first. */
  bills: Bill[];
  left: number;
  /** Paid beyond every bill. */
  advance: number;
  /** Paid without picking a bill (used up on the oldest). */
  unlinked: number;
}

/** Part of a payment put on one bill. */
export interface BillAllocation {
  billId: string;
  amount: number;
}

/** What a saved payment paid on one bill. */
export interface PaidBill {
  billId: string;
  number?: string;
  date: string;
  amount: number;
}

/**
 * Split a payment over the open bills, oldest first, leaving out `skip`.
 * `extra` is what no picked bill takes: saved as not linked to a bill.
 */
export function splitPayment(
  bills: Bill[],
  amount: number,
  skip: ReadonlySet<string> = new Set(),
): {split: BillAllocation[]; extra: number} {
  let rest = Math.round((Number.isNaN(amount) ? 0 : amount) * 100); // paise: no float drift
  const split: BillAllocation[] = [];
  for (const b of bills) {
    if (rest <= 0) break;
    if (skip.has(b.id) || b.left <= 0) continue;
    const take = Math.min(rest, Math.round(b.left * 100));
    split.push({billId: b.id, amount: take / 100});
    rest -= take;
  }
  return {split, extra: Math.max(rest, 0) / 100};
}
