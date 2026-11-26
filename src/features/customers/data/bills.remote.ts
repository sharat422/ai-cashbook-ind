import {apiRequest} from '@api/client';
import type {Bill, CustomerBills} from '@features/customers/domain/bills';

interface BillDto {
  id: string;
  date: string;
  number: string | null;
  amount: string;
  paid: string;
  left: string;
  status: Bill['status'];
}

/**
 *   GET /api/v1/customers/{id}/bills[?beat_id=]  -> {bills, left, advance, unlinked}
 * Staff read it through their beat (`beatId`); the server refuses any other.
 */
export const billsRemote = {
  async list(customerId: string, beatId?: string): Promise<CustomerBills> {
    const q = beatId ? `?beat_id=${encodeURIComponent(beatId)}` : '';
    const dto = await apiRequest<{bills: BillDto[]; left: string; advance: string; unlinked: string}>(
      `/customers/${customerId}/bills${q}`, {method: 'GET'});
    return {
      bills: dto.bills.map(b => ({id: b.id, date: b.date, number: b.number ?? undefined, amount: Number(b.amount),
        paid: Number(b.paid), left: Number(b.left), status: b.status})),
      left: Number(dto.left),
      advance: Number(dto.advance),
      unlinked: Number(dto.unlinked),
    };
  },
};
