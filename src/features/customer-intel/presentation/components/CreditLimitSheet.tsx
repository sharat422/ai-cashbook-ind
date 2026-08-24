import React, {useEffect, useState} from 'react';
import {View} from 'react-native';

import {AmountInput, FormField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';

export interface CreditLimitSheetProps {
  visible: boolean;
  current?: number;
  customerName: string;
  onClose: () => void;
  onSave: (amount: number) => void;
  onRemove: () => void;
}

/** Set / update / remove a customer's credit limit. */
export function CreditLimitSheet({
  visible,
  current,
  customerName,
  onClose,
  onSave,
  onRemove,
}: CreditLimitSheetProps): React.JSX.Element {
  const [amount, setAmount] = useState<number>(current ?? NaN);

  useEffect(() => {
    if (visible) setAmount(current ?? NaN);
  }, [visible, current]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Credit limit">
      <View className="px-5 pb-5 pt-1">
        <Text variant="caption" className="mb-4">
          Get an alert when {customerName}’s dues approach or exceed this limit.
        </Text>
        <FormField label="Credit limit (₹)">
          <AmountInput value={amount} onChange={setAmount} autoFocus />
        </FormField>
        <Button
          title="Save limit"
          className="mt-5"
          disabled={Number.isNaN(amount) || amount <= 0}
          onPress={() => onSave(amount)}
        />
        {current ? (
          <Button
            title="Remove limit"
            variant="ghost"
            className="mt-2"
            onPress={onRemove}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}
