import React, {useState} from 'react';
import {Pressable, TextInput, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {
  AI_CATEGORIES,
  type AiCategory,
} from '@features/categorization/domain/entities';
import {
  CategoryResultCard,
  DecisionHistory,
} from '@features/categorization/presentation/components';
import {useCategorize} from '@features/categorization/presentation/hooks';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '@features/expense/domain/entities';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';

const SAMPLE =
  'INDIAN OIL CORP\nRetail outlet, MG Road\nPetrol 28.4 L @ ₹104.50\n' +
  'Total ₹2,968.00  GST ₹452.74\nInvoice INV-77310  10/06/2026';

/** Map this service's categories onto the expense form's category set. */
function toExpenseCategory(category: AiCategory): ExpenseCategory {
  const match = EXPENSE_CATEGORIES.find(c => c === category);
  return (match ?? 'Miscellaneous') as ExpenseCategory;
}

/**
 * AI Expense Categorization: paste receipt text → get {category, confidence}
 * from GPT (or the offline rule engine), correct it if wrong, and review the
 * stored learning log.
 */
export function CategorizationScreen({
  navigation,
}: AppScreenProps<'Categorize'>): React.JSX.Element {
  const t = useT();
  const [text, setText] = useState('');
  const [correction, setCorrection] = useState<AiCategory | null>(null);
  const {
    categorize,
    decision,
    isCategorizing,
    correct,
    decisions,
    clearHistory,
    reset,
  } = useCategorize();

  const onCategorize = () => {
    if (!text.trim()) return;
    setCorrection(null);
    categorize(text.trim());
  };

  const onCorrect = (category: AiCategory) => {
    if (!decision) return;
    setCorrection(category);
    correct(decision.id, category);
  };

  const onReset = () => {
    setText('');
    setCorrection(null);
    reset();
  };

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">{t('categorize.title')}</Text>
        <Text variant="subtitle" className="mt-2">
          {t('categorize.subtitle')}
        </Text>

        {/* Input */}
        <View className="mt-6 rounded-xl border border-border bg-white px-4 py-3">
          <TextInput
            className="min-h-[110px] p-0 text-base text-slate-900"
            value={text}
            onChangeText={setText}
            placeholder={t('categorize.placeholder')}
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
          />
        </View>
        <View className="mt-2 flex-row justify-between">
          <Pressable onPress={() => setText(SAMPLE)}>
            <Text className="text-sm font-semibold text-primary">
              {t('categorize.tryExample')}
            </Text>
          </Pressable>
          {text.length > 0 ? (
            <Pressable onPress={onReset}>
              <Text className="text-sm font-semibold text-muted">{t('common.clear')}</Text>
            </Pressable>
          ) : null}
        </View>

        <Button
          title={t('categorize.cta')}
          className="mt-4"
          loading={isCategorizing}
          disabled={!text.trim()}
          onPress={onCategorize}
        />

        {/* Result */}
        {decision ? (
          <View className="mt-6">
            <CategoryResultCard result={decision.result} />

            {/* Correction */}
            <Text variant="label" className="mt-5 mb-2">
              {t('categorize.notRight')}
            </Text>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {AI_CATEGORIES.map(category => {
                const selected = correction === category;
                return (
                  <Pressable
                    key={category}
                    onPress={() => onCorrect(category)}
                    className={`rounded-full border px-3.5 py-2 ${
                      selected
                        ? 'border-success bg-success'
                        : 'border-border bg-white'
                    }`}>
                    <Text
                      className={`text-sm font-medium ${
                        selected ? 'text-white' : 'text-slate-700'
                      }`}>
                      {category}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {correction ? (
              <Text className="mt-2 text-xs font-medium text-success">
                {t('categorize.saved')}
              </Text>
            ) : null}

            <Button
              title={t('categorize.useInExpense')}
              variant="secondary"
              className="mt-5"
              onPress={() =>
                navigation.navigate('AddExpense', {
                  initialValues: {
                    category: toExpenseCategory(
                      correction ?? decision.result.category,
                    ),
                  },
                })
              }
            />
          </View>
        ) : null}

        {/* Learning log */}
        <View className="mt-8 mb-2 flex-row items-center justify-between">
          <Text variant="label">{t('categorize.learningLog')}</Text>
          {decisions.length > 0 ? (
            <Pressable onPress={clearHistory}>
              <Text className="text-sm font-semibold text-danger">{t('common.clear')}</Text>
            </Pressable>
          ) : null}
        </View>
        <DecisionHistory decisions={decisions} />
      </View>
    </Screen>
  );
}
