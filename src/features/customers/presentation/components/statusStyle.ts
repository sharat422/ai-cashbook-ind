import type {CustomerStatus} from '@features/customers/domain/entities';
import type {TKey} from '@/i18n';

/** Colour + label tokens for each dues status. Shared by badges and amounts. */
export const STATUS_STYLE: Record<
  CustomerStatus,
  {label: TKey; dot: string; chipBg: string; chipText: string; amount: string}
> = {
  'no-dues': {
    label: 'customers.statusNoDues',
    dot: 'bg-success',
    chipBg: 'bg-green-50',
    chipText: 'text-success',
    amount: 'text-slate-500',
  },
  pending: {
    label: 'customers.statusPending',
    dot: 'bg-amber-500',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
    amount: 'text-amber-700',
  },
  overdue: {
    label: 'customers.statusOverdue',
    dot: 'bg-danger',
    chipBg: 'bg-red-50',
    chipText: 'text-danger',
    amount: 'text-danger',
  },
};
