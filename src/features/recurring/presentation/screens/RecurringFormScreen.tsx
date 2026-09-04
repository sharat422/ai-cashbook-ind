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
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

const FREQUENCY_OPTIONS = RECURRING_FREQUENCIES.map(f => ({
  label: f[0].toUpperCase() + f.slice(1),
  value: f,
}));

/** Allow next-due dates up to ~10 years out (unlike the past-only expense form). */
const FAR_FUTURE = new Date(new Date().getFullYear() + 10, 11, 31);

export function RecurringFormScreen({
  navigation,
  route,
}: AppScreenProps<'RecurringForm'>): React.JSX.Element {
  const t = useT();
  const editing = route.params?.recurring;
  const {create, update, remove} = useRecurringMutations();

  const ACTIVE_OPTIONS = [
    {label: t('recurring.active'), value: true},
    {label: t('recurring.paused'), value: false},
  ];

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
  const [errorField, setErrorField] = useState<'name' | 'amount' | 'category' | null>(null);
  const clearError = () => {
    if (error) {
      setError(null);
      setErrorField(null);
    }
  };

  const onSave = () => {
    if (!name.trim()) {
      setError(t('recurring.errName'));
      setErrorField('name');
      return;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      setError(t('recurring.errAmount'));
      setErrorField('amount');
      return;
    }
    if (!category) {
      setError(t('recurring.errCategory'));
      setErrorField('category');
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
      Alert.alert(
        t('form.couldNotSave'),
        e instanceof Error ? e.message : t('ai.tryAgain'),
      );

    if (editing) {
      update.mutate({id: editing.id, draft}, {onSuccess, onError});
    } else {
      create.mutate(draft, {onSuccess, onError});
    }
  };

  const onDelete = () => {
    if (!editing) return;
    Alert.alert(
      t('recurring.deleteTitle'),
      t('recurring.deleteMsg', {name: editing.name}),
      [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('common.delete'),
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
          {editing ? t('recurring.editTitle') : t('recurring.newTitle')}
        </Text>

        <View className="mt-6" style={{gap: 18}}>
          <FormField
            label={t('recurring.name')}
            required
            error={errorField === 'name' ? error : null}>
            <TextField
              placeholder={t('recurring.namePlaceholder')}
              value={name}
              onChangeText={v => {
                setName(v);
                clearError();
              }}
              maxLength={120}
            />
          </FormField>

          <FormField
            label={t('form.amount')}
            required
            error={errorField === 'amount' ? error : null}>
            <AmountInput
              value={amount}
              onChange={v => {
                setAmount(v);
                clearError();
              }}
            />
          </FormField>

          <FormField
            label={t('form.category')}
            required
            error={errorField === 'category' ? error : null}>
            <Select
              placeholder={t('form.selectCategory')}
              options={EXPENSE_CATEGORIES as unknown as string[]}
              value={category}
              onSelect={v => {
                setCategory(v);
                clearError();
              }}
            />
          </FormField>

          <FormField label={t('recurring.paidTo')} hint={t('common.optional')}>
            <TextField
              placeholder={t('recurring.paidToPlaceholder')}
              value={vendor}
              onChangeText={setVendor}
              maxLength={120}
            />
          </FormField>

          <FormField label={t('recurring.frequency')}>
            <SegmentedControl
              value={frequency}
              options={FREQUENCY_OPTIONS}
              onChange={setFrequency}
            />
          </FormField>

          <FormField label={t('recurring.repeatEvery')} hint={frequencyLabel(frequency, interval)}>
            <Stepper value={interval} onChange={setInterval} />
          </FormField>

          <FormField label={t('recurring.nextDue')}>
            <DateField
              value={nextDueDate}
              onChange={setNextDueDate}
              maximumDate={FAR_FUTURE}
            />
          </FormField>

          <FormField label={t('form.notes')} hint={t('common.optional')}>
            <TextField
              placeholder={t('recurring.notesPlaceholder')}
              value={notes}
              onChangeText={setNotes}
              maxLength={200}
            />
          </FormField>

          {editing ? (
            <FormField label={t('recurring.status')}>
              <SegmentedControl
                value={active}
                options={ACTIVE_OPTIONS}
                onChange={setActive}
              />
            </FormField>
          ) : null}
        </View>

        <Button
          title={editing ? t('recurring.saveChanges') : t('recurring.addExpense')}
          className="mt-8"
          loading={saving}
          onPress={onSave}
        />
        {editing ? (
          <Button
            title={t('common.delete')}
            variant="ghost"
            className="mt-2"
            onPress={onDelete}
          />
        ) : (
          <Button
            title={t('common.cancel')}
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
