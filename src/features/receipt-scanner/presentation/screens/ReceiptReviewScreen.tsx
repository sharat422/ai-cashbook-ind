import React, {useEffect, useState} from 'react';
import {Image, View} from 'react-native';

import {AmountInput, ChipSelect, DateField, TextField} from '@components/form';
import {Button, ErrorState, Screen, Text} from '@components/ui';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '@features/expense/domain/entities';
import {
  ExtractedFieldRow,
  ScanProgress,
} from '@features/receipt-scanner/presentation/components';
import {useScanReceipt} from '@features/receipt-scanner/presentation/hooks';
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

interface CorrectedFields {
  vendor: string;
  invoiceNumber: string;
  gstNumber: string;
  amount: number;
  taxAmount: number;
  date: string;
  category: ExpenseCategory;
}

/** Build the expense notes from the receipt-only fields the user kept. */
function composeNotes(f: CorrectedFields): string {
  const parts: string[] = [];
  if (f.invoiceNumber.trim()) parts.push(`Invoice: ${f.invoiceNumber.trim()}`);
  if (f.gstNumber.trim()) parts.push(`GSTIN: ${f.gstNumber.trim()}`);
  if (!Number.isNaN(f.taxAmount) && f.taxAmount > 0) {
    parts.push(`Tax: ₹${f.taxAmount}`);
  }
  return parts.join(' · ');
}

/**
 * Step 2 of the scanner: run the AI extraction, show progress, then let the
 * user review/correct every field (each with its confidence) before creating
 * the expense draft.
 */
export function ReceiptReviewScreen({
  navigation,
  route,
}: AppScreenProps<'ReceiptReview'>): React.JSX.Element {
  const {image} = route.params;
  const {scan, stage, extraction, isError, error, reset} = useScanReceipt();
  const [fields, setFields] = useState<CorrectedFields | null>(null);

  // Kick off the scan once on mount.
  useEffect(() => {
    scan(image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed the editable fields the first time an extraction arrives.
  useEffect(() => {
    if (!extraction) return;
    setFields({
      vendor: extraction.vendorName.value,
      invoiceNumber: extraction.invoiceNumber.value,
      gstNumber: extraction.gstNumber.value,
      amount: extraction.amount.value,
      taxAmount: extraction.taxAmount.value,
      date: extraction.date.value || toISODate(new Date()),
      category: extraction.category.value,
    });
  }, [extraction]);

  const update = <K extends keyof CorrectedFields>(
    key: K,
    value: CorrectedFields[K],
  ) => setFields(prev => (prev ? {...prev, [key]: value} : prev));

  const onCreateDraft = () => {
    if (!fields) return;
    navigation.replace('AddExpense', {
      initialValues: {
        amount: Number.isNaN(fields.amount) ? undefined : fields.amount,
        category: fields.category,
        vendor: fields.vendor,
        date: fields.date,
        notes: composeNotes(fields),
      },
      initialAttachment: image,
    });
  };

  const retry = () => {
    reset();
    scan(image);
  };

  // --- Error ---
  if (isError) {
    return (
      <Screen>
        <View className="flex-1 justify-center py-8">
          <ErrorState
            title="Couldn't read the receipt"
            message={error?.message ?? 'Please try again with a clearer photo.'}
            onRetry={retry}
          />
          <Button
            title="Enter manually"
            variant="ghost"
            className="mt-3"
            onPress={() =>
              navigation.replace('AddExpense', {initialAttachment: image})
            }
          />
        </View>
      </Screen>
    );
  }

  // --- Scanning ---
  if (!extraction || !fields) {
    return (
      <Screen>
        <View className="py-8">
          <Text variant="title">Scanning receipt…</Text>
          <Text variant="subtitle" className="mt-2">
            Hang tight while we read and categorize your receipt.
          </Text>
          <View className="mt-6 items-center">
            <Image
              source={{uri: image.uri}}
              className="h-48 w-40 rounded-2xl"
              resizeMode="cover"
            />
          </View>
          <View className="mt-8">
            <ScanProgress stage={stage} />
          </View>
        </View>
      </Screen>
    );
  }

  // --- Review & correct ---
  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">Review details</Text>
        <Text variant="subtitle" className="mt-2">
          We pre-filled these from your receipt. Check the highlighted fields and
          fix anything that looks off.
        </Text>

        <View className="mt-6 flex-row items-center rounded-2xl border border-border bg-white p-3">
          <Image
            source={{uri: image.uri}}
            className="h-16 w-12 rounded-lg"
            resizeMode="cover"
          />
          <Text variant="caption" className="ml-3 flex-1">
            Tap any field to edit. Confidence is shown per field.
          </Text>
        </View>

        <View className="mt-6" style={{gap: 18}}>
          <ExtractedFieldRow
            label="Vendor name"
            confidence={extraction.vendorName.confidence}>
            <TextField
              value={fields.vendor}
              onChangeText={v => update('vendor', v)}
              placeholder="Vendor / payee"
            />
          </ExtractedFieldRow>

          <ExtractedFieldRow
            label="Amount"
            confidence={extraction.amount.confidence}>
            <AmountInput
              value={fields.amount}
              onChange={v => update('amount', v)}
            />
          </ExtractedFieldRow>

          <ExtractedFieldRow
            label="Tax amount"
            confidence={extraction.taxAmount.confidence}>
            <AmountInput
              value={fields.taxAmount}
              onChange={v => update('taxAmount', v)}
            />
          </ExtractedFieldRow>

          <ExtractedFieldRow
            label="Date"
            confidence={extraction.date.confidence}>
            <DateField
              value={fields.date}
              onChange={v => update('date', v)}
            />
          </ExtractedFieldRow>

          <ExtractedFieldRow
            label="Invoice number"
            confidence={extraction.invoiceNumber.confidence}>
            <TextField
              value={fields.invoiceNumber}
              onChangeText={v => update('invoiceNumber', v)}
              placeholder="Invoice / bill no."
              autoCapitalize="characters"
            />
          </ExtractedFieldRow>

          <ExtractedFieldRow
            label="GST number"
            confidence={extraction.gstNumber.confidence}>
            <TextField
              value={fields.gstNumber}
              onChangeText={v => update('gstNumber', v)}
              placeholder="GSTIN"
              autoCapitalize="characters"
            />
          </ExtractedFieldRow>

          <ExtractedFieldRow
            label="Category (AI suggested)"
            confidence={extraction.category.confidence}>
            <ChipSelect
              options={EXPENSE_CATEGORIES}
              value={fields.category}
              onSelect={v => update('category', v)}
            />
          </ExtractedFieldRow>
        </View>

        <Button
          title="Create expense draft"
          className="mt-8"
          onPress={onCreateDraft}
        />
        <Button
          title="Retake / choose another"
          variant="ghost"
          className="mt-2"
          onPress={() => navigation.replace('ReceiptCapture')}
        />
      </View>
    </Screen>
  );
}
