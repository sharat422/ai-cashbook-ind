import {useMemo} from 'react';

import type {Customer} from '@features/customers/domain/entities';
import type {CustomerLedger} from '@features/customers/domain/ledger';
import {
  deriveRiskFeatures,
  predictRisk,
  type RiskFeatures,
  type RiskPrediction,
} from '@features/customers/domain/risk';

/**
 * Compute the payment-risk prediction for a customer from their ledger.
 * Pure/in-memory — recomputes only when the ledger changes.
 */
export function useRiskPrediction(
  customer: Customer,
  ledger: CustomerLedger | undefined,
): {prediction: RiskPrediction; features: RiskFeatures} | null {
  return useMemo(() => {
    if (!ledger) return null;
    const features = deriveRiskFeatures(ledger, customer);
    return {features, prediction: predictRisk(features)};
  }, [customer, ledger]);
}
