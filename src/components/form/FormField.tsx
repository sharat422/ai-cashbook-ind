import React from 'react';
import {View} from 'react-native';

import {Text} from '@components/ui';

export interface FormFieldProps {
  label: string;
  error?: string | null;
  /** Optional helper/hint shown under the control when there's no error. */
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

/**
 * Layout wrapper for a single form control: label (with optional required
 * marker), the control, and an error/hint line. Keeps every field visually
 * consistent and centralizes the error styling.
 */
export function FormField({
  label,
  error,
  hint,
  required,
  children,
}: FormFieldProps): React.JSX.Element {
  return (
    <View>
      <Text variant="label" className="mb-1.5">
        {label}
        {required ? <Text className="text-danger"> *</Text> : null}
      </Text>

      {children}

      {error ? (
        <Text className="mt-1 text-xs text-danger">{error}</Text>
      ) : hint ? (
        <Text className="mt-1 text-xs text-muted">{hint}</Text>
      ) : null}
    </View>
  );
}
