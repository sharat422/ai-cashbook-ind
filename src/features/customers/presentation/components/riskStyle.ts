import type {RiskCategory} from '@features/customers/domain/risk';

/** Colour + label tokens per risk category (color-coded indicators). */
export const RISK_STYLE: Record<
  RiskCategory,
  {label: string; color: string; chipBg: string; chipText: string}
> = {
  low: {
    label: 'Low Risk',
    color: '#16A34A',
    chipBg: 'bg-green-50',
    chipText: 'text-success',
  },
  medium: {
    label: 'Medium Risk',
    color: '#F59E0B',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
  },
  high: {
    label: 'High Risk',
    color: '#DC2626',
    chipBg: 'bg-red-50',
    chipText: 'text-danger',
  },
};
