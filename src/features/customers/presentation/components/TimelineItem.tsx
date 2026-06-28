import React from 'react';
import {View} from 'react-native';

import type {LedgerEntryView} from '@features/customers/domain/ledger';
import {TransactionCard} from './TransactionCard';

/**
 * One row of the activity timeline: a coloured dot on a connecting rail plus the
 * reusable TransactionCard. Pass `isLast` to stop the rail at the final entry.
 */
function TimelineItemBase({
  entry,
  isLast,
}: {
  entry: LedgerEntryView;
  isLast: boolean;
}): React.JSX.Element {
  const isCredit = entry.type === 'credit';
  return (
    <View className="flex-row">
      {/* Rail */}
      <View className="w-6 items-center">
        <View
          className={`mt-5 h-3 w-3 rounded-full border-2 border-white ${
            isCredit ? 'bg-amber-500' : 'bg-success'
          }`}
        />
        {!isLast ? (
          <View className="mt-1 w-0.5 flex-1 bg-border" />
        ) : null}
      </View>

      {/* Card */}
      <View className="flex-1 pb-3 pl-2">
        <TransactionCard entry={entry} />
      </View>
    </View>
  );
}

export const TimelineItem = React.memo(TimelineItemBase);
