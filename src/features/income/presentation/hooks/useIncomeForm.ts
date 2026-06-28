import {useCallback, useMemo, useState} from 'react';

import type {
  Attachment,
  IncomeCategory,
  IncomeDraft,
} from '@features/income/domain/entities';
import {
  validateIncomeDraft,
  type IncomeFieldErrors,
} from '@features/income/domain/validation';
import {toISODate} from '@utils/date';

interface FormValues {
  amount: number;
  category: IncomeCategory | null;
  date: string;
  notes: string;
  attachment: Attachment | null;
}

const initialValues = (): FormValues => ({
  amount: NaN,
  category: null,
  date: toISODate(new Date()),
  notes: '',
  attachment: null,
});

/**
 * Owns the Add-Income form state. Validation runs against the same domain rule
 * the use case enforces, but errors only surface for fields the user has
 * touched (or after a submit attempt) to avoid shouting on first render.
 */
export function useIncomeForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const setField = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setValues(prev => ({...prev, [key]: value}));
      setTouched(prev => ({...prev, [key]: true}));
    },
    [],
  );

  const draft: IncomeDraft = useMemo(
    () => ({
      amount: values.amount,
      // Cast is safe: submit is blocked until category is set & valid.
      category: values.category as IncomeCategory,
      date: values.date,
      notes: values.notes.trim() || undefined,
      attachment: values.attachment,
    }),
    [values],
  );

  const allErrors: IncomeFieldErrors = useMemo(
    () => validateIncomeDraft(draft),
    [draft],
  );

  /** Errors limited to touched fields, unless a submit was attempted. */
  const visibleErrors: IncomeFieldErrors = useMemo(() => {
    if (submitAttempted) return allErrors;
    return Object.fromEntries(
      Object.entries(allErrors).filter(([key]) => touched[key]),
    );
  }, [allErrors, touched, submitAttempted]);

  const isValid = Object.keys(allErrors).length === 0;

  const reset = useCallback(() => {
    setValues(initialValues());
    setTouched({});
    setSubmitAttempted(false);
  }, []);

  return {
    values,
    setField,
    draft,
    errors: visibleErrors,
    isValid,
    markSubmitAttempted: () => setSubmitAttempted(true),
    reset,
  };
}
