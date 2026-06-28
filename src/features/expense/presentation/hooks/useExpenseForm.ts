import {useCallback, useMemo, useState} from 'react';

import type {
  Attachment,
  ExpenseCategory,
  ExpenseDraft,
} from '@features/expense/domain/entities';
import {
  validateExpenseDraft,
  type ExpenseFieldErrors,
} from '@features/expense/domain/validation';
import {toISODate} from '@utils/date';

interface FormValues {
  amount: number;
  category: ExpenseCategory | null;
  date: string;
  vendor: string;
  notes: string;
  attachment: Attachment | null;
}

export interface ExpenseFormSeed {
  amount?: number;
  category?: ExpenseCategory | null;
  vendor?: string;
  date?: string;
  notes?: string;
  attachment?: Attachment | null;
}

const initialValues = (seed?: ExpenseFormSeed): FormValues => ({
  amount: seed?.amount ?? NaN,
  category: seed?.category ?? null,
  date: seed?.date ?? toISODate(new Date()),
  vendor: seed?.vendor ?? '',
  notes: seed?.notes ?? '',
  attachment: seed?.attachment ?? null,
});

/**
 * Owns the Add-Expense form state. Validation runs against the same domain rule
 * the use case enforces, but errors only surface for fields the user has
 * touched (or after a submit attempt) to avoid shouting on first render.
 */
export function useExpenseForm(seed?: ExpenseFormSeed) {
  const [values, setValues] = useState<FormValues>(() => initialValues(seed));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const setField = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setValues(prev => ({...prev, [key]: value}));
      setTouched(prev => ({...prev, [key]: true}));
    },
    [],
  );

  const draft: ExpenseDraft = useMemo(
    () => ({
      amount: values.amount,
      // Cast is safe: submit is blocked until category is set & valid.
      category: values.category as ExpenseCategory,
      date: values.date,
      vendor: values.vendor.trim(),
      notes: values.notes.trim() || undefined,
      attachment: values.attachment,
    }),
    [values],
  );

  const allErrors: ExpenseFieldErrors = useMemo(
    () => validateExpenseDraft(draft),
    [draft],
  );

  /** Errors limited to touched fields, unless a submit was attempted. */
  const visibleErrors: ExpenseFieldErrors = useMemo(() => {
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
