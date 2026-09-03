import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';

import {
  AmountInput,
  AttachmentPicker,
  ChipSelect,
  type ChipOption,
  DateField,
  FormField,
  NotesInput,
  TextField,
} from '@components/form';
import {Button, Screen, SegmentedControl, Select, Text} from '@components/ui';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '@features/expense/domain/entities';
import {useCreateExpense} from '@features/expense/presentation/hooks';
import {
  INCOME_CATEGORIES,
  type IncomeCategory,
} from '@features/income/domain/entities';
import {useConnectivity, useCreateIncome} from '@features/income/presentation/hooks';
import type {Attachment} from '@/shared/types/attachment';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {toISODate} from '@utils/date';

type TxnType = 'income' | 'expense';

/** Silent defaults so a basic entry needs only an amount. */
const DEFAULT_INCOME_CATEGORY: IncomeCategory = 'Other';
const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'Miscellaneous';

/** Emoji per expense category for friendlier chips (mirrors Add Expense). */
const EXPENSE_ICONS: Record<string, string> = {
  Rent: '🏠',
  Salary: '👤',
  Fuel: '⛽',
  Food: '🍽️',
  Travel: '✈️',
  Utilities: '💡',
  Miscellaneous: '📦',
};
const EXPENSE_OPTIONS: ChipOption<string>[] = EXPENSE_CATEGORIES.map(value => ({
  value,
  icon: EXPENSE_ICONS[value],
}));
const INCOME_OPTIONS: readonly string[] = INCOME_CATEGORIES;

/**
 * Quick Add: one screen for both income and expense. The only required field is
 * the amount — type is a toggle, and category/vendor/date/attachment live under
 * a collapsed "Add details" section with sensible defaults, so a basic entry is
 * amount → Save.
 */
export function QuickAddScreen({
  navigation,
  route,
}: AppScreenProps<'QuickAdd'>): React.JSX.Element {
  const t = useT();
  const online = useConnectivity();
  const createIncome = useCreateIncome();
  const createExpense = useCreateExpense();

  const [type, setType] = useState<TxnType>(route.params?.type ?? 'expense');
  const [amount, setAmount] = useState<number>(NaN);
  const [note, setNote] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  // null = untouched → the silent default is used at save time.
  const [category, setCategory] = useState<string | null>(null);
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState<string>(toISODate(new Date()));
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);

  const saving = createIncome.isPending || createExpense.isPending;

  /** Switching type resets category (the two lists differ). */
  const onChangeType = (next: TxnType) => {
    setType(next);
    setCategory(null);
  };

  const defaultCategory =
    type === 'income' ? DEFAULT_INCOME_CATEGORY : DEFAULT_EXPENSE_CATEGORY;

  const finish = (pending: boolean) => {
    if (pending) {
      Alert.alert(t('entry.savedOfflineTitle'), t('entry.savedOfflineMsg'), [
        {text: t('common.ok'), onPress: () => navigation.goBack()},
      ]);
    } else {
      navigation.goBack();
    }
  };

  const onSubmit = () => {
    if (Number.isNaN(amount) || amount <= 0) {
      return setAmountError(t('ai.enterAmount'));
    }
    setAmountError(null);

    const trimmedNote = note.trim() || undefined;
    const chosenCategory = category ?? defaultCategory;

    if (type === 'income') {
      createIncome.mutate(
        {
          amount,
          category: chosenCategory as IncomeCategory,
          date,
          notes: trimmedNote,
          attachment,
        },
        {
          onSuccess: income => finish(income.syncStatus === 'pending'),
          onError: err => Alert.alert(t('form.couldNotSave'), err.message),
        },
      );
    } else {
      createExpense.mutate(
        {
          amount,
          category: chosenCategory as ExpenseCategory,
          date,
          vendor: vendor.trim(),
          notes: trimmedNote,
          attachment,
        },
        {
          onSuccess: expense => finish(expense.syncStatus === 'pending'),
          onError: err => Alert.alert(t('form.couldNotSave'), err.message),
        },
      );
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="py-6">
          <Text variant="title">{t('txn.quickTitle')}</Text>
          <Text variant="subtitle" className="mt-1">
            {t('txn.quickSubtitle')}
          </Text>

          {/* Type toggle */}
          <View className="mt-5">
            <SegmentedControl<TxnType>
              value={type}
              onChange={onChangeType}
              options={[
                {label: t('txn.typeIncome'), value: 'income'},
                {label: t('txn.typeExpense'), value: 'expense'},
              ]}
            />
          </View>

          {/* Amount hero — the only required field */}
          <View
            className={`mt-5 rounded-3xl px-5 pb-6 pt-5 ${
              type === 'income' ? 'bg-emerald-900' : 'bg-slate-900'
            }`}>
            <Text className="text-xs font-medium uppercase tracking-wide text-slate-300">
              {t('form.amount')}
            </Text>
            <View className="mt-3">
              <AmountInput
                value={amount}
                onChange={value => {
                  setAmount(value);
                  if (amountError) setAmountError(null);
                }}
                error={amountError}
                autoFocus
              />
            </View>
            {amountError ? (
              <Text className="mt-2 text-xs text-red-300">{amountError}</Text>
            ) : null}
          </View>

          {!online ? (
            <View className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
              <Text className="text-sm font-medium text-amber-700">
                {t('entry.offlineBanner')}
              </Text>
            </View>
          ) : null}

          {/* Note — optional, kept on the main surface */}
          <View className="mt-5">
            <NotesInput
              value={note}
              onChange={setNote}
              placeholder={t('txn.notePlaceholder')}
            />
          </View>

          {/* Collapsible details — everything here is optional/defaulted */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowDetails(v => !v)}
            className="mt-4 flex-row items-center justify-center py-2">
            <Text className="text-base font-semibold text-primary">
              {showDetails ? t('txn.hideDetails') : t('txn.addDetails')}
            </Text>
          </Pressable>

          {showDetails ? (
            <View className="mt-1" style={{gap: 18}}>
              <FormField
                label={t('form.category')}
                hint={t('txn.categoryDefaultHint', {category: defaultCategory})}>
                {type === 'income' ? (
                  <Select<string>
                    placeholder={t('form.selectCategory')}
                    options={INCOME_OPTIONS}
                    value={category}
                    onSelect={setCategory}
                  />
                ) : (
                  <ChipSelect<string>
                    options={EXPENSE_OPTIONS}
                    value={category}
                    onSelect={setCategory}
                  />
                )}
              </FormField>

              {type === 'expense' ? (
                <FormField label={t('txn.vendorLabel')}>
                  <TextField
                    placeholder={t('txn.vendorPlaceholder')}
                    value={vendor}
                    onChangeText={setVendor}
                    maxLength={80}
                    returnKeyType="done"
                  />
                </FormField>
              ) : null}

              <FormField label={t('form.date')}>
                <DateField value={date} onChange={setDate} />
              </FormField>

              <FormField label={t('form.attachment')}>
                <AttachmentPicker value={attachment} onChange={setAttachment} />
              </FormField>
            </View>
          ) : null}

          <Button
            title={type === 'income' ? t('txn.saveIncome') : t('txn.saveExpense')}
            className="mt-8"
            loading={saving}
            onPress={onSubmit}
          />
          <Button
            title={t('common.cancel')}
            variant="ghost"
            className="mt-2"
            onPress={() => navigation.goBack()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
