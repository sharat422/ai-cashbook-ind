import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {useT} from '@/i18n';

import type {LedgerEntryView} from '@features/customers/domain/ledger';
import {GstInvoiceStatus} from './GstInvoiceStatus';
import {TransactionCard} from './TransactionCard';

/**
 * One row of the activity timeline: a coloured dot on a connecting rail plus the
 * reusable TransactionCard. Pass `isLast` to stop the rail at the final entry.
 */
function TimelineItemBase({
  entry,
  isLast,
  customerId,
  onOpenBill,
}: {
  entry: LedgerEntryView;
  isLast: boolean;
  /** Shows a GST invoice's draft / issued / cancelled actions when given. */
  customerId?: string;
  /** Opens an item bill (or its return) from its entry. */
  onOpenBill?: (billId: string) => void;
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
        {onOpenBill ? <BillLink entry={entry} onOpen={onOpenBill} /> : null}
        {customerId ? <GstInvoiceStatus customerId={customerId} entry={entry} /> : null}
      </View>
    </View>
  );
}

export const TimelineItem = React.memo(TimelineItemBase);

/** An item bill's credit ("bill:<id>") or its return ("billret:<id>"): open the bill. */
function BillLink({entry, onOpen}: {entry: LedgerEntryView; onOpen: (billId: string) => void}): React.JSX.Element | null {
  const t = useT();
  const m = /^(bill|billret):(.+)$/.exec(entry.clientId ?? '');
  if (!m) return null;
  return (
    <Pressable testID={`open-bill-${entry.id}`} accessibilityRole="button" className="mt-1"
      onPress={() => onOpen(m[2])}>
      <Text className="text-xs font-semibold text-primary">
        {m[1] === 'bill' ? t('bill.openBill') : t('bill.openReturn')} ›
      </Text>
    </Pressable>
  );
}

/**
 * Keep a long ledger light on low-end phones: mount a screenful, add rows in
 * small batches, and drop off-screen rows from the native view tree.
 */
export const LEDGER_LIST_WINDOW = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 10,
  windowSize: 7,
  removeClippedSubviews: true,
} as const;
