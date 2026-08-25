import React, {useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import {AmountInput, DateField, FormField, TextField} from '@components/form';
import {Button, Screen, SegmentedControl, Select, Text} from '@components/ui';
import {EXPENSE_CATEGORIES} from '@features/expense/domain/entities';
import {
  RECURRING_FREQUENCIES,
  frequencyLabel,
  type RecurringDraft,
  type RecurringFrequency,
} from '@features/recurring/domain/entities';
import {useRecurringMutations} from '@features/recurring/presentation/hooks';
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

const FREQUENCY_OPTIONS = RECURRING_FREQUENCIES.map(f => ({
  label: f[0].toUpperCase() + f.slice(1),
  value: f,
}));

const ACTIVE_OPTIONS = [
  {label: 'Active', value: true},
  {label: 'Paused', value: false},
];

/** Allow next-due dates up to ~10 years out (unlike the past-only expense form). */
const FAR_FUTURE = new Date(new Date().getFullYear() + 10, 11, 31);

export function RecurringFormScreen({
  navigation,
  route,
}: AppScreenProps<'RecurringForm'>): React.JSX.Element {
  const editing = route.params?.recurring;
  const {create, update, remove} = useRecurringMutations();

  const [name, setName] = useState(editing?.name ?? '');
  const [amount, setAmount] = useState<number>(editing?.amount ?? NaN);
  const [category, setCategory] = useState<string | null>(
    editing?.category ?? 'Rent',
  );
  const [vendor, setVendor] = useState(editing?.vendor ?? '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    editing?.frequency ?? 'monthly',
  );
  const [interval, setInterval] = useState<number>(editing?.interval ?? 1);
  const [nextDueDate, setNextDueDate] = useState(
    editing?.nextDueDate ?? toISODate(new Date()),
  );
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const onSave = () => {
    if (!name.trim()) {
      setError('Enter a name');
      return;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (!category) {
      setError('Choose a category');
      return;
    }
    const draft: RecurringDraft = {
      name: name.trim(),
      amount,
      category,
      vendor: vendor.trim(),
      frequency,
      interval: Math.max(1, Math.round(interval)),
      nextDueDate,
      notes: notes.trim() || undefined,
      active,
    };

    const onSuccess = () => navigation.goBack();
    const onError = (e: unknown) =>
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again.');

    if (editing) {
      update.mutate({id: editing.id, draft}, {onSuccess, onError});
    } else {
      create.mutate(draft, {onSuccess, onError});
    }
  };

  const onDelete = () => {
    if (!editing) return;
    Alert.alert('Delete recurring expense?', `Remove "${editing.name}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(editing.id, {onSuccess: () => navigation.goBack()}),
      },
    ]);
  };

  const saving = create.isPending || update.isPending;

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">
          {editing ? 'Edit recurring' : 'New recurring expense'}
        </Text>

        <View className="mt-6" style={{gap: 18}}>
          <FormField label="Name" required error={error?.includes('name') ? error : null}>
            <TextField
              placeholder="e.g. Shop rent"
              value={name}
              onChangeText={v => {
                setName(v);
                if (error) setError(null);
              }}
              maxLength={120}
            />
          </FormField>

          <FormField label="Amount" required error={error?.includes('amount') ? error : null}>
            <AmountInput
              value={amount}
              onChange={v => {
                setAmount(v);
                if (error) setError(null);
              }}
            />
          </FormField>

          <FormField label="Category" required error={error?.includes('category') ? error : null}>
            <Select
              placeholder="Select category"
              options={EXPENSE_CATEGORIES as unknown as string[]}
              value={category}
              onSelect={v => {
                setCategory(v);
                if (error) setError(null);
              }}
            />
          </FormField>

          <FormField label="Paid to" hint="Optional">
            <TextField
              placeholder="e.g. Landlord"
              value={vendor}
              onChangeText={setVendor}
              maxLength={120}
            />
          </FormField>

          <FormField label="Frequency">
            <SegmentedControl
              value={frequency}
              options={FREQUENCY_OPTIONS}
              onChange={setFrequency}
            />
          </FormField>

          <FormField label="Repeat every" hint={frequencyLabel(frequency, interval)}>
            <Stepper value={interval} onChange={setInterval} />
          </FormField>

          <FormField label="Next due date">
            <DateField
              value={nextDueDate}
              onChange={setNextDueDate}
              maximumDate={FAR_FUTURE}
            />
          </FormField>

          <FormField label="Notes" hint="Optional">
            <TextField
              placeholder="Any details"
              value={notes}
              onChangeText={setNotes}
              maxLength={200}
            />
          </FormField>

          {editing ? (
            <FormField label="Status">
              <SegmentedControl
                value={active}
                options={ACTIVE_OPTIONS}
                onChange={setActive}
              />
            </FormField>
          ) : null}
        </View>

        <Button
          title={editing ? 'Save changes' : 'Add recurring expense'}
          className="mt-8"
          loading={saving}
          onPress={onSave}
        />
        {editing ? (
          <Button
            title="Delete"
            variant="ghost"
            className="mt-2"
            onPress={onDelete}
          />
        ) : (
          <Button
            title="Cancel"
            variant="ghost"
            className="mt-2"
            onPress={() => navigation.goBack()}
          />
        )}
      </View>
    </Screen>
  );
}

function Stepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): React.JSX.Element {
  const set = (v: number) => onChange(Math.min(60, Math.max(1, v)));
  return (
    <View className="h-14 flex-row items-center justify-between rounded-xl border border-border bg-white px-4">
      <StepButton label="−" onPress={() => set(value - 1)} disabled={value <= 1} />
      <Text className="text-xl font-semibold text-slate-900">{value}</Text>
      <StepButton label="+" onPress={() => set(value + 1)} disabled={value >= 60} />
    </View>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`h-10 w-14 items-center justify-center rounded-lg ${
        disabled ? 'bg-slate-100' : 'bg-primary/10'
      }`}>
      <Text
        className={`text-2xl font-semibold ${
          disabled ? 'text-muted' : 'text-primary'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}
