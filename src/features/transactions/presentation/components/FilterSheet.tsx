import React from 'react';
import {ScrollView, View} from 'react-native';

import {DateRangeField, FilterChip, RadioList} from '@components/filters';
import {BottomSheet, Button, Text} from '@components/ui';
import {useT, type TKey} from '@/i18n';
import {categoryLabel} from '@/i18n/labels';
import {
  ALL_CATEGORIES,
  type SortField,
  type TransactionFilters,
  type TransactionType,
} from '@features/transactions/domain/entities';

export interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filters: TransactionFilters;
  onSetType: (type: TransactionType | 'all') => void;
  onToggleCategory: (category: string) => void;
  onSetDateRange: (range: {from: string | null; to: string | null}) => void;
  onSetSort: (field: SortField, direction: 'asc' | 'desc') => void;
  onClear: () => void;
}

const TYPE_OPTIONS: Array<{label: TKey; value: TransactionType | 'all'}> = [
  {label: 'filters.all', value: 'all'},
  {label: 'txn.typeIncome', value: 'income'},
  {label: 'txn.typeExpense', value: 'expense'},
];

type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

const SORT_OPTIONS: Array<{key: SortKey; label: TKey; icon: string}> = [
  {key: 'date-desc', label: 'filters.dateNewest', icon: '📅'},
  {key: 'date-asc', label: 'filters.dateOldest', icon: '📅'},
  {key: 'amount-desc', label: 'filters.amountHigh', icon: '💵'},
  {key: 'amount-asc', label: 'filters.amountLow', icon: '💵'},
];

/** Bottom-sheet that composes the reusable filter controls for the history list. */
export function FilterSheet({
  visible,
  onClose,
  filters,
  onSetType,
  onToggleCategory,
  onSetDateRange,
  onSetSort,
  onClear,
}: FilterSheetProps): React.JSX.Element {
  const t = useT();
  const sortKey: SortKey = `${filters.sort.field}-${filters.sort.direction}` as SortKey;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('filters.title')}>
      <ScrollView
        className="px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 16}}>
        {/* Type */}
        <Text variant="label" className="mb-2 mt-1">
          {t('filters.type')}
        </Text>
        <View className="flex-row" style={{gap: 8}}>
          {TYPE_OPTIONS.map(option => (
            <FilterChip
              key={option.value}
              label={t(option.label)}
              selected={filters.type === option.value}
              onPress={() => onSetType(option.value)}
            />
          ))}
        </View>

        {/* Categories */}
        <Text variant="label" className="mb-2 mt-5">
          {t('filters.categories')}
        </Text>
        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {ALL_CATEGORIES.map(category => (
            <FilterChip
              key={category}
              label={categoryLabel(t, category)}
              selected={filters.categories.includes(category)}
              onPress={() => onToggleCategory(category)}
            />
          ))}
        </View>

        {/* Date range */}
        <Text variant="label" className="mb-2 mt-5">
          {t('filters.dateRange')}
        </Text>
        <DateRangeField
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={onSetDateRange}
        />

        {/* Sort */}
        <Text variant="label" className="mb-1 mt-5">
          {t('filters.sortBy')}
        </Text>
        <RadioList
          options={SORT_OPTIONS.map(o => ({...o, label: t(o.label)}))}
          value={sortKey}
          onSelect={key => {
            const [field, direction] = key.split('-') as [
              SortField,
              'asc' | 'desc',
            ];
            onSetSort(field, direction);
          }}
        />
      </ScrollView>

      {/* Actions */}
      <View
        className="flex-row border-t border-border px-5 py-3"
        style={{gap: 12}}>
        <Button
          title={t('filters.clearAll')}
          variant="secondary"
          className="flex-1"
          fullWidth={false}
          onPress={onClear}
        />
        <Button
          title={t('common.done')}
          className="flex-1"
          fullWidth={false}
          onPress={onClose}
        />
      </View>
    </BottomSheet>
  );
}
