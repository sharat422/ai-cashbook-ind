import React from 'react';
import {ScrollView, View} from 'react-native';

import {DateRangeField, FilterChip, RadioList} from '@components/filters';
import {BottomSheet, Button, Text} from '@components/ui';
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

const TYPE_OPTIONS: Array<{label: string; value: TransactionType | 'all'}> = [
  {label: 'All', value: 'all'},
  {label: 'Income', value: 'income'},
  {label: 'Expense', value: 'expense'},
];

type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

const SORT_OPTIONS: Array<{key: SortKey; label: string; icon: string}> = [
  {key: 'date-desc', label: 'Date: Newest first', icon: '📅'},
  {key: 'date-asc', label: 'Date: Oldest first', icon: '📅'},
  {key: 'amount-desc', label: 'Amount: High to Low', icon: '💵'},
  {key: 'amount-asc', label: 'Amount: Low to High', icon: '💵'},
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
  const sortKey: SortKey = `${filters.sort.field}-${filters.sort.direction}` as SortKey;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filters & sort">
      <ScrollView
        className="px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 16}}>
        {/* Type */}
        <Text variant="label" className="mb-2 mt-1">
          Type
        </Text>
        <View className="flex-row" style={{gap: 8}}>
          {TYPE_OPTIONS.map(option => (
            <FilterChip
              key={option.value}
              label={option.label}
              selected={filters.type === option.value}
              onPress={() => onSetType(option.value)}
            />
          ))}
        </View>

        {/* Categories */}
        <Text variant="label" className="mb-2 mt-5">
          Categories
        </Text>
        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {ALL_CATEGORIES.map(category => (
            <FilterChip
              key={category}
              label={category}
              selected={filters.categories.includes(category)}
              onPress={() => onToggleCategory(category)}
            />
          ))}
        </View>

        {/* Date range */}
        <Text variant="label" className="mb-2 mt-5">
          Date range
        </Text>
        <DateRangeField
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={onSetDateRange}
        />

        {/* Sort */}
        <Text variant="label" className="mb-1 mt-5">
          Sort by
        </Text>
        <RadioList
          options={SORT_OPTIONS}
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
          title="Clear all"
          variant="secondary"
          className="flex-1"
          fullWidth={false}
          onPress={onClear}
        />
        <Button
          title="Done"
          className="flex-1"
          fullWidth={false}
          onPress={onClose}
        />
      </View>
    </BottomSheet>
  );
}
