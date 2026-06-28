import {useCallback, useMemo, useState} from 'react';

import type {CustomerDraft} from '@features/customers/domain/entities';
import {
  validateCustomerDraft,
  type CustomerFieldErrors,
} from '@features/customers/domain/validation';

const empty = (seed?: Partial<CustomerDraft>): CustomerDraft => ({
  fullName: seed?.fullName ?? '',
  mobile: seed?.mobile ?? '',
  gstNumber: seed?.gstNumber ?? '',
  businessName: seed?.businessName ?? '',
  address: seed?.address ?? '',
  notes: seed?.notes ?? '',
});

/**
 * Owns the add/edit customer form. Validation runs against the same domain rule
 * as the use case; errors surface only for touched fields (or after submit).
 */
export function useCustomerForm(seed?: Partial<CustomerDraft>) {
  const [values, setValues] = useState<CustomerDraft>(() => empty(seed));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const setField = useCallback(
    <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => {
      setValues(prev => ({...prev, [key]: value}));
      setTouched(prev => ({...prev, [key]: true}));
    },
    [],
  );

  const allErrors = useMemo<CustomerFieldErrors>(
    () => validateCustomerDraft(values),
    [values],
  );

  const errors = useMemo<CustomerFieldErrors>(() => {
    if (submitAttempted) return allErrors;
    return Object.fromEntries(
      Object.entries(allErrors).filter(([key]) => touched[key]),
    );
  }, [allErrors, touched, submitAttempted]);

  const isValid = Object.keys(allErrors).length === 0;

  return {
    values,
    setField,
    draft: values,
    errors,
    isValid,
    markSubmitAttempted: () => setSubmitAttempted(true),
  };
}
