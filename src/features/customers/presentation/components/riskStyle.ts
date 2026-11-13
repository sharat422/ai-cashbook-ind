import type {RiskCategory} from '@features/customers/domain/risk';
import type {TKey} from '@/i18n';

/** Colour + label tokens per risk category (color-coded indicators). */
export const RISK_STYLE: Record<
  RiskCategory,
  {label: TKey; color: string; chipBg: string; chipText: string}
> = {
  low: {
    label: 'customers.riskLow',
    color: '#16A34A',
    chipBg: 'bg-green-50',
    chipText: 'text-success',
  },
  medium: {
    label: 'customers.riskMedium',
    color: '#F59E0B',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
  },
  high: {
    label: 'customers.riskHigh',
    color: '#DC2626',
    chipBg: 'bg-red-50',
    chipText: 'text-danger',
  },
};
